/**
 * Re-login warnings for bank connections whose consent runs out (Enable
 * Banking, Ponto, GoCardless BAD), and the rule that stops automatic tenant
 * reminders while the bank data behind a lease is stale.
 *
 * Pure functions only; the job that sends the emails lives in
 * bankReauthWarnings.ts.
 */

import { ymdInZone } from "../lib/timezone";

/** Days before expiry at which the landlord is emailed; 0 = the day it expired. */
export const REAUTH_STAGES = [14, 7, 3, 1, 0] as const;
export type ReauthStage = (typeof REAUTH_STAGES)[number];

/** How long before expiry the in-app banner shows. */
export const REAUTH_BANNER_DAYS = 14;

function dayNumber(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** Calendar days from today to the expiry date, both seen in the timezone. */
export function daysUntilExpiry(expiresAt: Date, now: Date, tz: string): number {
  return dayNumber(ymdInZone(expiresAt, tz)) - dayNumber(ymdInZone(now, tz));
}

export interface ConnectionLike {
  status: string;
  consentExpiresAt: Date | null;
  lastSyncAt?: Date | null;
}

/**
 * Whether the connection still delivers fresh bank data. Not when it is
 * expired or in error, nor when its consent end passed without a successful
 * sync since.
 */
export function isConnectionStale(conn: ConnectionLike, now: Date): boolean {
  if (conn.status === "expired" || conn.status === "error") return true;
  if (conn.status !== "active") return false;
  if (conn.consentExpiresAt && conn.consentExpiresAt.getTime() <= now.getTime()) {
    return !conn.lastSyncAt || conn.lastSyncAt.getTime() <= conn.consentExpiresAt.getTime();
  }
  return false;
}

/**
 * The warning stage that is due now, or null when nothing is due yet. A
 * missed day catches up with the tightest stage that applies (6 days left
 * gives stage 7). Expired or failing connections are at stage 0.
 */
export function dueReauthStage(conn: ConnectionLike, now: Date, tz: string): ReauthStage | null {
  if (conn.status === "revoked" || conn.status === "pending") return null;
  if (isConnectionStale(conn, now)) return 0;
  if (!conn.consentExpiresAt) return null;
  const days = daysUntilExpiry(conn.consentExpiresAt, now, tz);
  if (days <= 0) return 0;
  let due: ReauthStage | null = null;
  for (const stage of REAUTH_STAGES) {
    if (days <= stage) due = stage;
  }
  return due;
}

/** Each stage is sent once; a re-login resets the stored stage to null. */
export function shouldSendReauthWarning(
  due: ReauthStage | null,
  lastStage: number | null | undefined,
): boolean {
  if (due === null) return false;
  if (lastStage === null || lastStage === undefined) return true;
  return due < lastStage;
}

export function normalizeIban(iban: string | null | undefined): string {
  return (iban || "").replace(/\s+/g, "").toUpperCase();
}

export function maskIban(iban: string | null | undefined): string {
  const n = normalizeIban(iban);
  if (n.length < 8) return n || "";
  return `${n.slice(0, 4)} •••• ${n.slice(-4)}`;
}

/**
 * IBANs of the landlord's accounts whose bank data is stale: a connection on
 * it is expired, in error or past its consent, and no other healthy active
 * connection covers the same IBAN.
 */
export function staleMonitoredIbans(
  connections: Array<ConnectionLike & { iban: string | null }>,
  now: Date,
): Set<string> {
  const stale = new Set<string>();
  const healthy = new Set<string>();
  for (const c of connections) {
    const iban = normalizeIban(c.iban);
    if (!iban) continue;
    if (isConnectionStale(c, now)) stale.add(iban);
    else if (c.status === "active") healthy.add(iban);
  }
  for (const iban of healthy) stale.delete(iban);
  return stale;
}

/**
 * The account a lease's rent is paid into: the lease's own bank account, else
 * the landlord's default account, else their only account.
 */
export function leaseReceivingIban(
  lease: { bankAccountId: string | null },
  accounts: Array<{ id: string; iban: string; isDefault: boolean; isArchived?: boolean }>,
): string | null {
  if (lease.bankAccountId) {
    const own = accounts.find((a) => a.id === lease.bankAccountId);
    if (own) return normalizeIban(own.iban);
  }
  const live = accounts.filter((a) => !a.isArchived);
  const def = live.find((a) => a.isDefault);
  if (def) return normalizeIban(def.iban);
  if (live.length === 1) return normalizeIban(live[0]!.iban);
  return null;
}

// ---------- Email copy ----------

export interface ReauthEmailVars {
  name: string | null;
  bankName: string;
  ibanMasked: string;
  /** dd/mm/yyyy */
  expiryDate: string;
  stage: ReauthStage;
  url: string;
}

interface ReauthCopy {
  greeting: (name: string | null) => string;
  subject: (bank: string, stage: ReauthStage) => string;
  lead: (v: ReauthEmailVars) => string;
  action: string;
  consequence: string;
}

const account = (v: ReauthEmailVars) => (v.ibanMasked ? ` (${v.ibanMasked})` : "");

const COPY: Record<"en" | "nl" | "fr" | "de", ReauthCopy> = {
  nl: {
    greeting: (n) => (n ? `Beste ${n},` : "Beste,"),
    subject: (bank, stage) =>
      stage === 0
        ? `Je bankkoppeling met ${bank} is verlopen. Log opnieuw in zodat de opvolging van je huur verder loopt`
        : stage === 1
          ? `Log morgen opnieuw in bij ${bank}, anders stopt de opvolging van je huur`
          : `Log binnen ${stage} dagen opnieuw in bij ${bank}, anders stopt de opvolging van je huur`,
    lead: (v) =>
      v.stage === 0
        ? `Je bankkoppeling met ${v.bankName}${account(v)} is verlopen of werkt niet meer (${v.expiryDate}).`
        : `Je bankkoppeling met ${v.bankName}${account(v)} verloopt op ${v.expiryDate}. Je bank vraagt om af en toe opnieuw in te loggen.`,
    action: "Opnieuw inloggen duurt een minuut:",
    consequence:
      "Zolang de koppeling verlopen is, ziet Rentular geen nieuwe overschrijvingen op deze rekening en worden betalingen niet automatisch herkend. Daarom sturen we dan geen automatische herinneringen naar huurders van wie de huur op deze rekening binnenkomt: zo krijgt niemand een herinnering voor huur die al betaald is. Handmatige herinneringen blijven mogelijk.",
  },
  en: {
    greeting: (n) => (n ? `Dear ${n},` : "Hello,"),
    subject: (bank, stage) =>
      stage === 0
        ? `Your bank connection with ${bank} has expired. Log in again so rent follow-up keeps running`
        : stage === 1
          ? `Log in again at ${bank} tomorrow, or rent follow-up stops`
          : `Log in again at ${bank} within ${stage} days, or rent follow-up stops`,
    lead: (v) =>
      v.stage === 0
        ? `Your bank connection with ${v.bankName}${account(v)} has expired or stopped working (${v.expiryDate}).`
        : `Your bank connection with ${v.bankName}${account(v)} expires on ${v.expiryDate}. Your bank asks you to log in again every now and then.`,
    action: "Logging in again takes a minute:",
    consequence:
      "While the connection is expired, Rentular sees no new transfers on this account and payments are not recognised automatically. So no automatic reminders go out to tenants whose rent is paid into this account: nobody gets a reminder for rent that was already paid. You can still send reminders yourself.",
  },
  fr: {
    greeting: (n) => (n ? `Bonjour ${n},` : "Bonjour,"),
    subject: (bank, stage) =>
      stage === 0
        ? `Votre connexion bancaire avec ${bank} a expiré. Reconnectez-vous pour que le suivi des loyers continue`
        : stage === 1
          ? `Reconnectez-vous demain chez ${bank}, sinon le suivi de vos loyers s'arrête`
          : `Reconnectez-vous chez ${bank} dans les ${stage} jours, sinon le suivi de vos loyers s'arrête`,
    lead: (v) =>
      v.stage === 0
        ? `Votre connexion bancaire avec ${v.bankName}${account(v)} a expiré ou ne fonctionne plus (${v.expiryDate}).`
        : `Votre connexion bancaire avec ${v.bankName}${account(v)} expire le ${v.expiryDate}. Votre banque demande de vous reconnecter de temps en temps.`,
    action: "Se reconnecter prend une minute :",
    consequence:
      "Tant que la connexion est expirée, Rentular ne voit plus les nouveaux virements sur ce compte et les paiements ne sont plus reconnus automatiquement. Nous n'envoyons donc aucun rappel automatique aux locataires dont le loyer arrive sur ce compte : personne ne reçoit de rappel pour un loyer déjà payé. Vous pouvez toujours envoyer un rappel vous-même.",
  },
  de: {
    greeting: (n) => (n ? `Hallo ${n},` : "Hallo,"),
    subject: (bank, stage) =>
      stage === 0
        ? `Ihre Bankverbindung mit ${bank} ist abgelaufen. Melden Sie sich erneut an, damit die Mietverfolgung weiterläuft`
        : stage === 1
          ? `Melden Sie sich morgen erneut bei ${bank} an, sonst stoppt die Verfolgung Ihrer Mieten`
          : `Melden Sie sich innerhalb von ${stage} Tagen erneut bei ${bank} an, sonst stoppt die Verfolgung Ihrer Mieten`,
    lead: (v) =>
      v.stage === 0
        ? `Ihre Bankverbindung mit ${v.bankName}${account(v)} ist abgelaufen oder funktioniert nicht mehr (${v.expiryDate}).`
        : `Ihre Bankverbindung mit ${v.bankName}${account(v)} läuft am ${v.expiryDate} ab. Ihre Bank verlangt ab und zu eine neue Anmeldung.`,
    action: "Die erneute Anmeldung dauert eine Minute:",
    consequence:
      "Solange die Verbindung abgelaufen ist, sieht Rentular keine neuen Überweisungen auf diesem Konto und Zahlungen werden nicht automatisch erkannt. Deshalb gehen keine automatischen Erinnerungen an Mieter, deren Miete auf dieses Konto eingeht: So bekommt niemand eine Erinnerung für bereits bezahlte Miete. Erinnerungen von Hand bleiben möglich.",
  },
};

export function buildReauthEmail(
  locale: string | null | undefined,
  v: ReauthEmailVars,
): { subject: string; body: string } {
  const lang = (locale || "en").slice(0, 2) as keyof typeof COPY;
  const c = COPY[lang] || COPY.en;
  const subject = c.subject(v.bankName, v.stage);
  const body = `${c.greeting(v.name)}\n\n${c.lead(v)}\n\n${c.action}\n${v.url}\n\n${c.consequence}\n\nRentular\n`;
  return { subject, body };
}

/** dd/mm/yyyy of an instant in a timezone. */
export function formatDateInZone(at: Date, tz: string): string {
  const [y, m, d] = ymdInZone(at, tz).split("-");
  return `${d}/${m}/${y}`;
}
