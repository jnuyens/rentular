import { and, eq, gte, inArray, sql } from "drizzle-orm";
import {
  getDb,
  bankConnections,
  bankStatements,
  communications,
  leaseTenants,
  tenantBankAccounts,
  tenants,
  users,
} from "@rentular/db";
import { decryptOrNull } from "../lib/bankTransactionView";
import { normalizeIban } from "./tenantBankAccounts";
import { queueEmail } from "../jobs/emailQueueWorker";
import { formatReminderAmount } from "./reminderText";
import type { SupportedLanguage } from "@rentular/shared";

type Db = ReturnType<typeof getDb>;

/** How many days before the due date a transfer still counts as paying it. */
export const REVIEW_DAYS_BEFORE_DUE = 8;

/** Metadata kind of the landlord email about a transfer waiting for review. */
export const TRANSFER_REVIEW_KIND = "transfer_review";

/** An incoming bank line not booked on any payment yet. */
export type WaitingTransfer = {
  id: string;
  amount: number;
  bookingDate: string;
  iban: string | null;
};

export type TransferHit = WaitingTransfer & { reason: "tenant_iban" | "amount" };

function cents(n: string | number): number {
  return Math.round((Number(n) || 0) * 100);
}

function shiftYmd(ymd: string, days: number): string {
  const d = new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10))));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The unbooked incoming transfer that may already pay a reminder, or null.
 * It counts when it was booked on or after the due date (or up to
 * REVIEW_DAYS_BEFORE_DUE days before it) and either comes from a known
 * account of the lease's tenants or is exactly the amount being reminded.
 * A known tenant account wins over a same-amount transfer from elsewhere.
 */
export function findWaitingTransfer(
  transfers: WaitingTransfer[],
  input: { dueDate: string; amount: number; tenantIbans: Set<string> },
): TransferHit | null {
  const from = shiftYmd(String(input.dueDate).slice(0, 10), -REVIEW_DAYS_BEFORE_DUE);
  const inWindow = transfers.filter(
    (t) => t.amount > 0 && String(t.bookingDate).slice(0, 10) >= from,
  );
  const byIban = inWindow.find((t) => t.iban && input.tenantIbans.has(normalizeIban(t.iban)));
  if (byIban) return { ...byIban, reason: "tenant_iban" };
  const want = cents(input.amount);
  const byAmount = want > 0 ? inWindow.find((t) => cents(t.amount) === want) : undefined;
  if (byAmount) return { ...byAmount, reason: "amount" };
  return null;
}

/** Known accounts of the tenants on a lease (tenant bank accounts and the legacy column). */
async function leaseTenantIbans(db: Db, leaseId: string): Promise<Set<string>> {
  const accounts = await db
    .select({ iban: tenantBankAccounts.iban })
    .from(tenantBankAccounts)
    .innerJoin(leaseTenants, eq(leaseTenants.tenantId, tenantBankAccounts.tenantId))
    .where(eq(leaseTenants.leaseId, leaseId));
  const legacy = await db
    .select({ iban: tenants.iban })
    .from(tenants)
    .innerJoin(leaseTenants, eq(leaseTenants.tenantId, tenants.id))
    .where(eq(leaseTenants.leaseId, leaseId));
  return new Set(
    [...accounts, ...legacy].map((r) => normalizeIban(r.iban)).filter((v) => v.length > 0),
  );
}

/**
 * Look for an unbooked incoming transfer on the owner's bank accounts that may
 * already pay this reminder. Used before any tenant reminder goes out.
 */
export async function loadWaitingTransfer(
  db: Db,
  input: { leaseId: string; ownerId: string; dueDate: string; amount: number },
): Promise<TransferHit | null> {
  const from = shiftYmd(String(input.dueDate).slice(0, 10), -REVIEW_DAYS_BEFORE_DUE);
  const rows = await db
    .select({
      id: bankStatements.id,
      amount: bankStatements.amount,
      bookingDate: bankStatements.bookingDate,
      counterpartyIbanEncrypted: bankStatements.counterpartyIbanEncrypted,
      counterpartyIbanIv: bankStatements.counterpartyIbanIv,
      counterpartyIbanAuthTag: bankStatements.counterpartyIbanAuthTag,
    })
    .from(bankStatements)
    .innerJoin(bankConnections, eq(bankConnections.id, bankStatements.connectionId))
    .where(
      and(
        eq(bankConnections.ownerId, input.ownerId),
        inArray(bankStatements.matchStatus, ["unmatched", "mismatched_amount"]),
        gte(bankStatements.bookingDate, from),
      ),
    );
  const transfers: WaitingTransfer[] = rows
    .map((r) => ({
      id: r.id,
      amount: Number(r.amount),
      bookingDate: String(r.bookingDate).slice(0, 10),
      iban:
        normalizeIban(
          decryptOrNull(r.counterpartyIbanEncrypted, r.counterpartyIbanIv, r.counterpartyIbanAuthTag),
        ) || null,
    }))
    .filter((t) => t.amount > 0);
  if (transfers.length === 0) return null;
  const tenantIbans = await leaseTenantIbans(db, input.leaseId);
  return findWaitingTransfer(transfers, { dueDate: input.dueDate, amount: input.amount, tenantIbans });
}

type Copy = { subject: (p: string) => string; body: (v: Record<string, string>) => string };

const COPY: Record<SupportedLanguage, Copy> = {
  en: {
    subject: (p) => `A transfer for ${p} is waiting for you to check`,
    body: (v) =>
      `Hello,\n\nA reminder to ${v.tenant} for ${v.property} (${v.amount}, due ${v.due}) was about to go out, but a transfer of ${v.transfer} booked on ${v.booked} may already pay it. Rentular could not book it on its own, so the reminder was not sent.\n\nPlease have a look and link the transfer to the right rent:\n${v.link}\n\nAs long as the transfer stays unchecked, the tenant gets no reminder for this rent.\n\nRentular`,
  },
  nl: {
    subject: (p) => `Een overschrijving voor ${p} wacht op je controle`,
    body: (v) =>
      `Hallo,\n\nEr stond een herinnering klaar voor ${v.tenant} voor ${v.property} (${v.amount}, te betalen op ${v.due}), maar een overschrijving van ${v.transfer} van ${v.booked} betaalt die misschien al. Rentular kon ze niet zelf koppelen, dus de herinnering is niet verstuurd.\n\nKijk even na en koppel de overschrijving aan de juiste huur:\n${v.link}\n\nZolang de overschrijving niet nagekeken is, krijgt de huurder voor deze huur geen herinnering.\n\nRentular`,
  },
  fr: {
    subject: (p) => `Un virement pour ${p} attend votre vérification`,
    body: (v) =>
      `Bonjour,\n\nUn rappel allait partir vers ${v.tenant} pour ${v.property} (${v.amount}, à payer le ${v.due}), mais un virement de ${v.transfer} reçu le ${v.booked} le règle peut-être déjà. Rentular n'a pas pu le relier tout seul, le rappel n'a donc pas été envoyé.\n\nVérifiez-le et reliez le virement au bon loyer :\n${v.link}\n\nTant que le virement n'est pas vérifié, le locataire ne reçoit aucun rappel pour ce loyer.\n\nRentular`,
  },
  de: {
    subject: (p) => `Eine Überweisung für ${p} wartet auf Ihre Prüfung`,
    body: (v) =>
      `Hallo,\n\nEine Erinnerung an ${v.tenant} für ${v.property} (${v.amount}, fällig am ${v.due}) stand bereit, aber eine Überweisung von ${v.transfer} vom ${v.booked} begleicht sie vielleicht schon. Rentular konnte sie nicht selbst zuordnen, deshalb wurde die Erinnerung nicht verschickt.\n\nBitte prüfen Sie sie und ordnen Sie die Überweisung der richtigen Miete zu:\n${v.link}\n\nSolange die Überweisung nicht geprüft ist, bekommt der Mieter für diese Miete keine Erinnerung.\n\nRentular`,
  },
};

function fmtYmd(d: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
}

/** Whether the landlord was already told about a waiting transfer for this payment. */
async function alreadyNotified(db: Db, leaseId: string, paymentId: string): Promise<boolean> {
  const rows = await db
    .select({ id: communications.id })
    .from(communications)
    .where(
      and(
        eq(communications.leaseId, leaseId),
        sql`JSON_UNQUOTE(JSON_EXTRACT(${communications.metadata}, '$.kind')) = ${TRANSFER_REVIEW_KIND}`,
        sql`JSON_UNQUOTE(JSON_EXTRACT(${communications.metadata}, '$.paymentId')) = ${paymentId}`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Hold a tenant reminder because a transfer may already pay it, and tell the
 * landlord once per payment, with a link to the reconciliation page.
 */
export async function holdForWaitingTransfer(
  db: Db,
  input: {
    hit: TransferHit;
    paymentId: string;
    leaseId: string;
    ownerId: string;
    tenantName: string;
    propertyName: string;
    amount: number;
    dueDate: string;
    to?: string;
    cc?: string;
    what: string;
  },
): Promise<void> {
  console.log(
    `[PaymentCheck] ${input.what} for payment ${input.paymentId} not sent: transfer ${input.hit.id} (${input.hit.amount.toFixed(2)}, ${input.hit.bookingDate}, ${input.hit.reason}) is waiting for review`,
  );
  try {
    if (await alreadyNotified(db, input.leaseId, input.paymentId)) return;
    const owner = (
      await db
        .select({ name: users.name, email: users.email, locale: users.locale })
        .from(users)
        .where(eq(users.id, input.ownerId))
        .limit(1)
    )[0];
    const to = input.to || owner?.email;
    if (!to) return;
    const lang = (["en", "nl", "fr", "de"].includes(owner?.locale || "") ? owner!.locale : "en") as SupportedLanguage;
    const copy = COPY[lang];
    const base = (process.env.WEB_URL || "https://www.rentular.com").replace(/\/$/, "");
    const subject = copy.subject(input.propertyName);
    const body = copy.body({
      tenant: input.tenantName,
      property: input.propertyName,
      amount: formatReminderAmount(input.amount, lang),
      due: fmtYmd(input.dueDate),
      transfer: formatReminderAmount(input.hit.amount, lang),
      booked: fmtYmd(input.hit.bookingDate),
      link: `${base}/reconciliation`,
    });
    await queueEmail(
      { to, cc: input.cc, subject, body },
      undefined,
      {
        ownerId: input.ownerId,
        leaseId: input.leaseId,
        type: "other",
        recipientName: owner?.name || to,
        metadata: {
          kind: TRANSFER_REVIEW_KIND,
          paymentId: input.paymentId,
          statementId: input.hit.id,
          trigger: "schedule",
        },
      },
    );
  } catch (err) {
    console.error(`[PaymentCheck] transfer review email failed for ${input.paymentId}:`, err);
  }
}
