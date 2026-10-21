import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import {
  getDb,
  communications,
  leases,
  properties,
  propertyManagers,
  users,
} from "@rentular/db";
import type { PropertyManagerRole } from "@rentular/shared";
import { hasMinimumRole } from "../lib/propertyAccess";
import { isWhatsAppConfigured, sendWhatsApp } from "../lib/whatsapp";
import { queueEmail } from "../jobs/emailQueueWorker";
import { computeIndexationCore } from "./indexationCalc";
import { formatEur } from "../lib/belgianFormat";

// Daily "indexation due" digest for landlords and property managers.
// The decision functions below are pure so they can be unit tested without a
// database; runIndexationAlerts wires them to the DB and the send channels.

export interface AlertLease {
  leaseId: string;
  propertyId: string;
  ownerId: string;
  propertyLabel: string;
  currentRent: number;
  newRent: number | null;
  applicableFrom: string;
}

export interface AlertUser {
  id: string;
  email: string;
  name: string | null;
  locale: string | null;
  whatsappNumber: string | null;
  indexationAlertsEnabled: boolean;
}

export type AlertChannel = "whatsapp" | "email";

/**
 * Whether a lease should be included in today's digest.
 *
 * The dedup key is the alert cycle date (see alertCycleDate): one alert per
 * lease per anniversary. A lease that stays unapplied is reminded again at its
 * next anniversary instead of never again. The daily job missing the exact day
 * does not matter. On the first run after deployment every lease that is
 * already past its applicable date gets one alert; those are exactly the
 * indexations a landlord has been forgetting.
 */
export function isAlertDue(
  lease: {
    startDate: string;
    indexationEnabled: boolean;
    status: string;
    type: string;
    indexationBaseIndex: string | null;
    indexationAlertSentFor: string | null;
  },
  core: { canApply: boolean; applicableFrom: string; currentIndexPublished: boolean },
  today: Date = new Date()
): boolean {
  if (!lease.indexationEnabled) return false;
  if (lease.status !== "active") return false;
  if (lease.type === "student") return false;
  if (!lease.indexationBaseIndex) return false;
  if (!core.canApply || !core.currentIndexPublished) return false;
  // YYYY-MM-DD strings compare correctly as text.
  const cycle = alertCycleDate(lease.startDate, core.applicableFrom, today);
  if (lease.indexationAlertSentFor && lease.indexationAlertSentFor >= cycle) {
    return false;
  }
  return true;
}

/**
 * The anniversary an alert belongs to: the later of applicableFrom and the most
 * recent contract anniversary on or before today. For a lease indexed on time
 * the two are the same day. For a lease left unapplied, applicableFrom stays in
 * the past while the anniversary moves on every year, so it is alerted again.
 */
export function alertCycleDate(
  startDate: string,
  applicableFrom: string,
  today: Date = new Date()
): string {
  const [y, m, d] = startDate.split("-").map(Number) as [number, number, number];
  const todayStr = today.toISOString().split("T")[0]!;
  let year = Number(todayStr.slice(0, 4));
  const pad = (n: number) => String(n).padStart(2, "0");
  let anniversary = `${year}-${pad(m)}-${pad(d)}`;
  if (anniversary > todayStr) {
    year -= 1;
    anniversary = `${year}-${pad(m)}-${pad(d)}`;
  }
  if (year <= y) return applicableFrom;
  return anniversary > applicableFrom ? anniversary : applicableFrom;
}

/**
 * The property owner plus every accepted member with manager rights or more.
 * Accountants and viewers do not get indexation alerts.
 */
export function resolveAlertRecipients(
  ownerId: string,
  members: Array<{ userId: string; role: PropertyManagerRole }>
): string[] {
  const out: string[] = [ownerId];
  for (const m of members) {
    if (!hasMinimumRole(m.role, "manager")) continue;
    if (!out.includes(m.userId)) out.push(m.userId);
  }
  return out;
}

/** WhatsApp when a number is set and the bridge is configured, else email; null when opted out. */
export function resolveAlertChannel(
  user: Pick<AlertUser, "whatsappNumber" | "indexationAlertsEnabled" | "email">,
  whatsappConfigured: boolean
): AlertChannel | null {
  if (!user.indexationAlertsEnabled) return null;
  if (user.whatsappNumber && whatsappConfigured) return "whatsapp";
  return "email";
}

/** Group due leases per recipient: one digest per person, items in input order. */
export function buildDigests(
  items: AlertLease[],
  recipientsByLease: Map<string, string[]>
): Map<string, AlertLease[]> {
  const digests = new Map<string, AlertLease[]>();
  for (const item of items) {
    for (const userId of recipientsByLease.get(item.leaseId) ?? []) {
      const list = digests.get(userId) ?? [];
      list.push(item);
      digests.set(userId, list);
    }
  }
  return digests;
}

interface DigestCopy {
  subject: (count: number) => string;
  greeting: (name: string | null) => string;
  intro: (count: number) => string;
  currentRent: string;
  newRent: string;
  newRentUnknown: string;
  closing: (count: number) => string;
}

const COPY: Record<"en" | "nl" | "fr" | "de", DigestCopy> = {
  en: {
    subject: (n) =>
      n === 1 ? "Rent indexation due for 1 lease" : `Rent indexation due for ${n} leases`,
    greeting: (name) => (name ? `Hello ${name},` : "Hello,"),
    intro: (n) =>
      n === 1
        ? "The rent indexation for this lease can be applied from today:"
        : `The rent indexation can now be applied for ${n} leases:`,
    currentRent: "Current rent",
    newRent: "New rent",
    newRentUnknown: "New rent cannot be calculated yet",
    closing: (n) =>
      n === 1
        ? "Open the link to review and apply it."
        : "Open each link to review and apply the indexation.",
  },
  nl: {
    subject: (n) =>
      n === 1
        ? "Huurindexering mogelijk voor 1 huurcontract"
        : `Huurindexering mogelijk voor ${n} huurcontracten`,
    greeting: (name) => (name ? `Hallo ${name},` : "Hallo,"),
    intro: (n) =>
      n === 1
        ? "Voor dit huurcontract mag je de huur vanaf vandaag indexeren:"
        : `Voor ${n} huurcontracten mag je de huur nu indexeren:`,
    currentRent: "Huidige huur",
    newRent: "Nieuwe huur",
    newRentUnknown: "Nieuwe huur kan nog niet berekend worden",
    closing: (n) =>
      n === 1
        ? "Open de link om de indexering na te kijken en toe te passen."
        : "Open elke link om de indexering na te kijken en toe te passen.",
  },
  fr: {
    subject: (n) =>
      n === 1 ? "Indexation du loyer possible pour 1 bail" : `Indexation du loyer possible pour ${n} baux`,
    greeting: (name) => (name ? `Bonjour ${name},` : "Bonjour,"),
    intro: (n) =>
      n === 1
        ? "Le loyer de ce bail peut être indexé à partir d'aujourd'hui :"
        : `Le loyer peut maintenant être indexé pour ${n} baux :`,
    currentRent: "Loyer actuel",
    newRent: "Nouveau loyer",
    newRentUnknown: "Le nouveau loyer ne peut pas encore être calculé",
    closing: (n) =>
      n === 1
        ? "Ouvrez le lien pour vérifier et appliquer l'indexation."
        : "Ouvrez chaque lien pour vérifier et appliquer l'indexation.",
  },
  de: {
    subject: (n) =>
      n === 1 ? "Mietindexierung fällig für 1 Mietvertrag" : `Mietindexierung fällig für ${n} Mietverträge`,
    greeting: (name) => (name ? `Hallo ${name},` : "Hallo,"),
    intro: (n) =>
      n === 1
        ? "Die Miete für diesen Mietvertrag kann ab heute indexiert werden:"
        : `Für ${n} Mietverträge kann die Miete jetzt indexiert werden:`,
    currentRent: "Aktuelle Miete",
    newRent: "Neue Miete",
    newRentUnknown: "Die neue Miete kann noch nicht berechnet werden",
    closing: (n) =>
      n === 1
        ? "Öffnen Sie den Link, um die Indexierung zu prüfen und anzuwenden."
        : "Öffnen Sie jeweils den Link, um die Indexierung zu prüfen und anzuwenden.",
  },
};

/**
 * Plain-text digest used for both WhatsApp and email. sendWhatsApp appends
 * WHATSAPP_SIGNATURE itself, so it is not added here.
 */
export function renderDigest(
  lang: string,
  items: AlertLease[],
  webUrl: string,
  recipientName: string | null = null
): { subject: string; body: string } {
  const key = (lang || "en").slice(0, 2).toLowerCase();
  const copy = COPY[key as keyof typeof COPY] ?? COPY.en;
  const n = items.length;

  const blocks = items.map((item) => {
    const lines = [item.propertyLabel, `${copy.currentRent}: ${formatEur(item.currentRent)}`];
    lines.push(
      item.newRent !== null ? `${copy.newRent}: ${formatEur(item.newRent)}` : copy.newRentUnknown
    );
    lines.push(`${webUrl}/indexation?lease=${item.leaseId}`);
    return lines.join("\n");
  });

  const body = [copy.greeting(recipientName), copy.intro(n), ...blocks, copy.closing(n)].join("\n\n");
  return { subject: copy.subject(n), body };
}

function normaliseLabelPart(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Human label for a property in the alert digest. When the property name
 * already holds the street and number (e.g. "Tervuursestraat 97 leuven"), the
 * address is not repeated: a trailing city in the name is dropped and only
 * "postalCode City" is appended.
 */
export function formatPropertyLabel(p: {
  name: string | null;
  street: string | null;
  streetNumber: string | null;
  postalCode: string | null;
  city: string | null;
}): string {
  const streetLine = [p.street, p.streetNumber].filter(Boolean).join(" ");
  const cityLine = [p.postalCode, p.city].filter(Boolean).join(" ");
  const name = (p.name ?? "").replace(/\s+/g, " ").trim();

  if (
    name &&
    streetLine.trim() &&
    normaliseLabelPart(name).includes(normaliseLabelPart(streetLine))
  ) {
    let base = name;
    const city = (p.city ?? "").replace(/\s+/g, " ").trim();
    if (city) {
      const trailingCity = new RegExp(`(^|[\\s,])${escapeRegExp(city)}$`, "i");
      const stripped = base.replace(trailingCity, "$1").replace(/[\s,]+$/, "");
      if (stripped) base = stripped;
    }
    return [base, cityLine].filter((s) => s && s.trim()).join(", ");
  }

  return [name, streetLine, cityLine].filter((s) => s && s.trim()).join(", ");
}

export interface IndexationAlertSummary {
  leasesChecked: number;
  leasesDue: number;
  digests: number;
  whatsapp: number;
  email: number;
  failed: number;
}

/** Find leases whose indexation became applicable, send one digest per person, mark them alerted. */
export async function runIndexationAlerts(now: Date = new Date()): Promise<IndexationAlertSummary> {
  const db = getDb();
  const summary: IndexationAlertSummary = {
    leasesChecked: 0,
    leasesDue: 0,
    digests: 0,
    whatsapp: 0,
    email: 0,
    failed: 0,
  };

  const rows = await db
    .select({
      lease: leases,
      propertyName: properties.name,
      street: properties.street,
      streetNumber: properties.streetNumber,
      postalCode: properties.postalCode,
      city: properties.city,
      epcLabel: properties.epcLabel,
      propertyOwnerId: properties.ownerId,
    })
    .from(leases)
    .innerJoin(properties, eq(leases.propertyId, properties.id))
    .where(
      and(
        eq(leases.status, "active"),
        eq(leases.indexationEnabled, true),
        isNotNull(leases.indexationBaseIndex)
      )
    );

  const due: AlertLease[] = [];
  const ownerByProperty = new Map<string, string>();

  for (const row of rows) {
    const lease = row.lease;
    if (lease.type === "student") continue;
    summary.leasesChecked++;
    try {
      const core = await computeIndexationCore({
        baseRent: Number(lease.baseRent ?? lease.monthlyRent),
        baseIndex: Number(lease.indexationBaseIndex),
        region: lease.region,
        startDate: lease.startDate,
        epcLabel: row.epcLabel ?? null,
        leaseType: lease.type,
        lastIndexationDate: lease.lastIndexationDate,
        paymentDay: lease.paymentDay,
      });
      if (!isAlertDue(lease, core)) continue;
      const cycle = alertCycleDate(lease.startDate, core.applicableFrom);
      const currentRent = Number(lease.monthlyRent);
      const newRent =
        Number.isFinite(core.newRent) && core.newRent !== currentRent ? core.newRent : null;
      due.push({
        leaseId: lease.id,
        propertyId: lease.propertyId,
        ownerId: row.propertyOwnerId,
        propertyLabel: formatPropertyLabel({
          name: row.propertyName,
          street: row.street,
          streetNumber: row.streetNumber,
          postalCode: row.postalCode,
          city: row.city,
        }),
        currentRent,
        newRent,
        applicableFrom: cycle,
      });
      ownerByProperty.set(lease.propertyId, row.propertyOwnerId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[IndexationAlert] Skipping lease ${lease.id}: ${message}`);
    }
  }

  summary.leasesDue = due.length;
  if (due.length === 0) {
    console.log("[IndexationAlert] No leases due today");
    return summary;
  }

  // Recipients per property: owner plus accepted manager+ members.
  const propertyIds = [...ownerByProperty.keys()];
  const memberRows = await db
    .select({
      propertyId: propertyManagers.propertyId,
      userId: propertyManagers.userId,
      role: propertyManagers.role,
    })
    .from(propertyManagers)
    .where(
      and(
        inArray(propertyManagers.propertyId, propertyIds),
        isNotNull(propertyManagers.acceptedAt)
      )
    );
  const membersByProperty = new Map<string, Array<{ userId: string; role: PropertyManagerRole }>>();
  for (const m of memberRows) {
    if (!m.userId) continue; // invite not linked to an account yet
    const list = membersByProperty.get(m.propertyId) ?? [];
    list.push({ userId: m.userId, role: m.role as PropertyManagerRole });
    membersByProperty.set(m.propertyId, list);
  }
  const recipientsByProperty = new Map<string, string[]>();
  for (const [propertyId, ownerId] of ownerByProperty) {
    recipientsByProperty.set(
      propertyId,
      resolveAlertRecipients(ownerId, membersByProperty.get(propertyId) ?? [])
    );
  }
  const recipientsByLease = new Map<string, string[]>();
  for (const item of due) {
    recipientsByLease.set(item.leaseId, recipientsByProperty.get(item.propertyId) ?? []);
  }

  const digests = buildDigests(due, recipientsByLease);
  const userIds = [...digests.keys()];
  const userRows: AlertUser[] =
    userIds.length > 0
      ? await db
          .select({
            id: users.id,
            email: users.email,
            name: users.name,
            locale: users.locale,
            whatsappNumber: users.whatsappNumber,
            indexationAlertsEnabled: users.indexationAlertsEnabled,
          })
          .from(users)
          .where(inArray(users.id, userIds))
      : [];
  const userById = new Map(userRows.map((u) => [u.id, u]));

  const whatsappConfigured = isWhatsAppConfigured();
  const webUrl = (process.env.WEB_URL || "https://www.rentular.com").replace(/\/$/, "");

  for (const [userId, items] of digests) {
    const user = userById.get(userId);
    if (!user) continue;
    const channel = resolveAlertChannel(user, whatsappConfigured);
    if (!channel) continue;

    summary.digests++;
    const { subject, body } = renderDigest(user.locale || "en", items, webUrl, user.name);
    const leaseIds = items.map((i) => i.leaseId);
    const singleLeaseId = items.length === 1 ? items[0]!.leaseId : null;
    const recipientName = user.name || user.email;

    let sendEmail = channel === "email";
    if (channel === "whatsapp" && user.whatsappNumber) {
      try {
        const { id } = await sendWhatsApp({ to: user.whatsappNumber, body });
        summary.whatsapp++;
        await logWhatsApp({
          ownerId: user.id,
          leaseId: singleLeaseId,
          recipientName,
          recipientPhone: user.whatsappNumber,
          body,
          status: "sent",
          externalId: id,
          sentAt: now,
          leaseIds,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[IndexationAlert] WhatsApp to user ${user.id} failed, falling back to email:`,
          message
        );
        summary.failed++;
        await logWhatsApp({
          ownerId: user.id,
          leaseId: singleLeaseId,
          recipientName,
          recipientPhone: user.whatsappNumber,
          body,
          status: "failed",
          errorMessage: message,
          leaseIds,
        });
        sendEmail = true;
      }
    }

    if (sendEmail) {
      try {
        await queueEmail({ to: user.email, subject, body }, undefined, {
          ownerId: user.id,
          leaseId: singleLeaseId ?? undefined,
          type: "indexation_alert",
          recipientName,
        });
        summary.email++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[IndexationAlert] Email to user ${user.id} failed:`, message);
        summary.failed++;
      }
    }
  }

  // Mark every due lease, also those without reachable recipients, so the job
  // does not pick them up again until next year's anniversary.
  for (const item of due) {
    try {
      await db
        .update(leases)
        .set({ indexationAlertSentFor: item.applicableFrom })
        .where(eq(leases.id, item.leaseId));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[IndexationAlert] Could not mark lease ${item.leaseId} as alerted:`, message);
    }
  }

  console.log(
    `[IndexationAlert] Checked ${summary.leasesChecked}, due ${summary.leasesDue}, digests ${summary.digests}, whatsapp ${summary.whatsapp}, email ${summary.email}, failed ${summary.failed}`
  );
  return summary;
}

async function logWhatsApp(entry: {
  ownerId: string;
  leaseId: string | null;
  recipientName: string;
  recipientPhone: string;
  body: string;
  status: "sent" | "failed";
  externalId?: string;
  errorMessage?: string;
  sentAt?: Date;
  leaseIds: string[];
}): Promise<void> {
  try {
    await getDb()
      .insert(communications)
      .values({
        id: randomUUID(),
        ownerId: entry.ownerId,
        leaseId: entry.leaseId,
        channel: "whatsapp",
        type: "indexation_alert",
        recipientName: entry.recipientName,
        recipientPhone: entry.recipientPhone,
        body: entry.body,
        status: entry.status,
        externalId: entry.externalId ?? null,
        errorMessage: entry.errorMessage ?? null,
        sentAt: entry.sentAt ?? null,
        metadata: { leaseIds: entry.leaseIds },
      });
  } catch (err) {
    console.error("[IndexationAlert] Failed to log WhatsApp communication:", err);
  }
}
