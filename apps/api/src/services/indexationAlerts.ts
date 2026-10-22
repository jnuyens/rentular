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
import { computeIndexationCore, localYmd } from "./indexationCalc";
import { formatEur } from "../lib/belgianFormat";
import {
  normaliseSnoozeLang,
  signIndexationSnoozeToken,
  type SnoozeOption,
} from "../lib/indexationSnoozeToken";

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
 *
 * A snooze from the digest overrides the anniversary rule: while
 * indexationSnoozedUntil is after today the lease is left out, and from that
 * day on it is due again even though this anniversary was already alerted.
 */
export function isAlertDue(
  lease: {
    startDate: string;
    indexationEnabled: boolean;
    status: string;
    type: string;
    indexationBaseIndex: string | null;
    indexationAlertSentFor: string | null;
    indexationSnoozedUntil: string | null;
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
  if (lease.indexationSnoozedUntil) {
    return lease.indexationSnoozedUntil <= localYmd(today);
  }
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

const pad2 = (n: number): string => String(n).padStart(2, "0");

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/**
 * The day a snoozed alert comes back: one or three calendar months after
 * todayYmd, with the day clamped to the end of a shorter month (31 January
 * plus one month is 28 or 29 February). "yearly" returns null: the snooze is
 * cleared and the normal next-anniversary rule takes over.
 */
export function snoozeUntil(todayYmd: string, snooze: SnoozeOption): string | null {
  if (snooze === "yearly") return null;
  const [y, m, d] = todayYmd.split("-").map(Number) as [number, number, number];
  const months = snooze === "1m" ? 1 : 3;
  const target = new Date(y, m - 1 + months, 1);
  const year = target.getFullYear();
  const month = target.getMonth();
  const day = Math.min(d, daysInMonth(year, month));
  return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}

/**
 * The first contract anniversary strictly after todayYmd. A 29 February start
 * date falls on 28 February in non-leap years.
 */
export function nextAnniversaryAfter(startDate: string, todayYmd: string): string {
  const [, m, d] = startDate.split("-").map(Number) as [number, number, number];
  const at = (year: number): string =>
    `${year}-${pad2(m)}-${pad2(Math.min(d, daysInMonth(year, m - 1)))}`;
  const year = Number(todayYmd.slice(0, 4));
  const thisYear = at(year);
  return thisYear > todayYmd ? thisYear : at(year + 1);
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
  open: string;
  snooze1m: string;
  snooze3m: string;
  snoozeYearly: string;
  snoozeHint: string;
}

/** Pre-signed snooze links for one lease, built by the caller. */
export interface SnoozeUrls {
  m1: string;
  m3: string;
  yearly: string;
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
    open: "Open indexation",
    snooze1m: "Remind me next month",
    snooze3m: "Remind me in 3 months",
    snoozeYearly: "Remind me at the next yearly indexation",
    snoozeHint: "Not now? Pick when we should remind you again:",
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
    open: "Indexering openen",
    snooze1m: "Herinner me volgende maand",
    snooze3m: "Herinner me binnen 3 maanden",
    snoozeYearly: "Herinner me bij de volgende jaarlijkse indexering",
    snoozeHint: "Nu niet? Kies wanneer we je er opnieuw aan herinneren:",
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
    open: "Ouvrir l'indexation",
    snooze1m: "Me le rappeler le mois prochain",
    snooze3m: "Me le rappeler dans 3 mois",
    snoozeYearly: "Me le rappeler à la prochaine indexation annuelle",
    snoozeHint: "Pas maintenant ? Choisissez quand nous devons vous le rappeler :",
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
    open: "Indexierung öffnen",
    snooze1m: "Nächsten Monat erinnern",
    snooze3m: "In 3 Monaten erinnern",
    snoozeYearly: "Bei der nächsten jährlichen Indexierung erinnern",
    snoozeHint: "Jetzt nicht? Wählen Sie, wann wir Sie wieder erinnern sollen:",
  },
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const BUTTON_BASE =
  "display:inline-block;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:14px";
const PRIMARY_BUTTON = `${BUTTON_BASE};background:#111;color:#fff`;
const SNOOZE_BUTTON = `${BUTTON_BASE};background:#fff;color:#111;border:1px solid #ccc;margin:4px 4px 0 0`;

function button(href: string, label: string, style: string): string {
  return `<a href="${escapeHtml(href)}" style="${style}">${escapeHtml(label)}</a>`;
}

/**
 * The digest in plain text (used for WhatsApp and as the email text part) and
 * as an email-safe HTML document with an open button per lease. When the
 * caller passes pre-signed snooze links, each lease also gets three snooze
 * buttons, and the plain text lists the same links. sendWhatsApp appends
 * WHATSAPP_SIGNATURE itself, so it is not added here.
 */
export function renderDigest(
  lang: string,
  items: AlertLease[],
  webUrl: string,
  recipientName: string | null = null,
  snoozeUrls?: Map<string, SnoozeUrls>
): { subject: string; body: string; html: string } {
  const raw = (lang || "en").slice(0, 2).toLowerCase();
  const key: keyof typeof COPY = Object.hasOwn(COPY, raw) ? (raw as keyof typeof COPY) : "en";
  const copy = COPY[key];
  const n = items.length;

  const blocks = items.map((item) => {
    const lines = [item.propertyLabel, `${copy.currentRent}: ${formatEur(item.currentRent)}`];
    lines.push(
      item.newRent !== null ? `${copy.newRent}: ${formatEur(item.newRent)}` : copy.newRentUnknown
    );
    lines.push(`${webUrl}/indexation?lease=${item.leaseId}`);
    const snooze = snoozeUrls?.get(item.leaseId);
    if (snooze) {
      lines.push(
        `${copy.snooze1m}: ${snooze.m1}`,
        `${copy.snooze3m}: ${snooze.m3}`,
        `${copy.snoozeYearly}: ${snooze.yearly}`
      );
    }
    return lines.join("\n");
  });

  const body = [copy.greeting(recipientName), copy.intro(n), ...blocks, copy.closing(n)].join("\n\n");

  const p = (text: string, style = "margin:0 0 16px 0"): string =>
    `<p style="${style}">${escapeHtml(text)}</p>`;
  const cell = "padding:2px 0;font-size:14px;color:#333";

  const leaseTables = items.map((item) => {
    const openUrl = `${webUrl}/indexation?lease=${encodeURIComponent(item.leaseId)}`;
    const newRentRow =
      item.newRent !== null
        ? `<tr><td style="${cell}">${escapeHtml(copy.newRent)}: <strong>${escapeHtml(formatEur(item.newRent))}</strong></td></tr>`
        : `<tr><td style="${cell}">${escapeHtml(copy.newRentUnknown)}</td></tr>`;
    const snooze = snoozeUrls?.get(item.leaseId);
    const snoozeRows = snooze
      ? `<tr><td style="padding:14px 0 0 0;font-size:13px;color:#666">${escapeHtml(copy.snoozeHint)}</td></tr>` +
        `<tr><td style="padding:2px 0 0 0">` +
        button(snooze.m1, copy.snooze1m, SNOOZE_BUTTON) +
        button(snooze.m3, copy.snooze3m, SNOOZE_BUTTON) +
        button(snooze.yearly, copy.snoozeYearly, SNOOZE_BUTTON) +
        `</td></tr>`
      : "";
    return (
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px 0;padding:16px;border:1px solid #e5e5e5;border-radius:10px">` +
      `<tr><td style="padding:0 0 6px 0;font-size:15px;color:#111"><strong>${escapeHtml(item.propertyLabel)}</strong></td></tr>` +
      `<tr><td style="${cell}">${escapeHtml(copy.currentRent)}: ${escapeHtml(formatEur(item.currentRent))}</td></tr>` +
      newRentRow +
      `<tr><td style="padding:12px 0 0 0">${button(openUrl, copy.open, PRIMARY_BUTTON)}</td></tr>` +
      snoozeRows +
      `</table>`
    );
  });

  const html =
    `<!doctype html><html lang="${key}"><head><meta charset="utf-8"><title>${escapeHtml(copy.subject(n))}</title></head>` +
    `<body style="margin:0;padding:0;background:#f5f5f7;font-family:Arial,Helvetica,sans-serif">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7">` +
    `<tr><td align="center" style="padding:24px 12px">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px">` +
    `<tr><td style="padding:28px 28px 12px 28px;font-size:15px;line-height:1.5;color:#111">` +
    p(copy.greeting(recipientName)) +
    p(copy.intro(n)) +
    leaseTables.join("") +
    p(copy.closing(n), "margin:0") +
    `</td></tr>` +
    `<tr><td style="padding:12px 28px 24px 28px;font-size:12px;color:#999">Rentular</td></tr>` +
    `</table></td></tr></table></body></html>`;

  return { subject: copy.subject(n), body, html };
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
    // One signed link per lease per snooze option, in the recipient's language
    // so the confirmation page matches the email. A signing failure only drops
    // the snooze buttons for this person; the digest still goes out.
    const lang = normaliseSnoozeLang(user.locale);
    let snoozeUrls: Map<string, SnoozeUrls> | undefined;
    try {
      const urls = new Map<string, SnoozeUrls>();
      const linkFor = async (leaseId: string, snooze: SnoozeOption): Promise<string> =>
        `${webUrl}/api/v1/landlord-action/indexation/${await signIndexationSnoozeToken({ leaseId, snooze, lang })}`;
      for (const item of items) {
        urls.set(item.leaseId, {
          m1: await linkFor(item.leaseId, "1m"),
          m3: await linkFor(item.leaseId, "3m"),
          yearly: await linkFor(item.leaseId, "yearly"),
        });
      }
      snoozeUrls = urls;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[IndexationAlert] Could not sign snooze links for user ${user.id}:`, message);
    }
    const { subject, body, html } = renderDigest(lang, items, webUrl, user.name, snoozeUrls);
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
        await queueEmail({ to: user.email, subject, body, html }, undefined, {
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
  // does not pick them up again until next year's anniversary. Sending the
  // digest also consumes any snooze that brought the lease back.
  for (const item of due) {
    try {
      await db
        .update(leases)
        .set({ indexationAlertSentFor: item.applicableFrom, indexationSnoozedUntil: null })
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
