/**
 * Tenant replies to a contract's reply address (reply+<token>@domain).
 *
 * A reply is filed in the contract's communication history as an inbound
 * tenant_reply row and passed on to the people who manage the property, with
 * Reply-To set to the tenant so a manager can answer directly. Auto-replies
 * and bounces are filed but not passed on. Mail to an unknown or revoked
 * token goes to the fallback address as an attachment and is not filed.
 *
 * The caller (POST /inbound/email) maps the outcome to an HTTP status: 200
 * when the message has been dealt with, 502 when the forward failed, so the
 * email worker sends the raw message to its own fallback and nothing is lost.
 */
import crypto from "crypto";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { getDb, communications, leases, properties, users } from "@rentular/db";
import { parseMail, htmlToText, trimQuotedReply, type MailAddress, type ParsedMail } from "../lib/mimeParse";
import { parseReplyAddress, replyDomain, resolveLeaseReplyToken } from "../lib/replyAddress";
import { getLeaseEmailRecipients } from "../lib/leaseRecipients";
import { getLandlordNotificationRecipients } from "../lib/notificationRecipients";
import { sendEmail, type EmailOptions } from "../lib/email";
import { sendEmailLogged, ccList } from "../lib/communicationLog";

export const MAX_FORWARD_ATTACHMENTS_BYTES = 10 * 1024 * 1024;
const MAX_BODY_CHARS = 60_000;

export interface InboundLease {
  id: string;
  ownerId: string;
  propertyId: string;
  propertyName: string;
  ownerEmail: string | null;
  ownerLocale: string | null;
}

export interface MatchedCommunication {
  id: string;
  recipientEmail: string | null;
  cc: string[];
}

export interface InboundRow {
  ownerId: string;
  leaseId: string;
  senderName: string;
  senderEmail: string | null;
  subject: string;
  body: string;
  sentAt: Date;
  metadata: Record<string, unknown>;
}

export interface InboundDeps {
  resolveToken(token: string): Promise<string | null>;
  loadLease(leaseId: string): Promise<InboundLease | null>;
  tenantEmails(leaseId: string): Promise<string[]>;
  hasMessageId(leaseId: string, messageId: string): Promise<boolean>;
  findCommunication(leaseId: string, by: { tag: string | null; ids: string[] }): Promise<MatchedCommunication | null>;
  insertInbound(row: InboundRow): Promise<string>;
  managers(propertyId: string, ownerEmail: string | null): Promise<{ to: string; cc?: string }>;
  /** Send and log the forward to the managers (landlord_notification row). */
  sendForward(options: EmailOptions, log: { ownerId: string; leaseId: string; metadata: Record<string, unknown> }): Promise<void>;
  /** Plain send, not logged against a contract. */
  sendPlain(options: EmailOptions): Promise<void>;
  webUrl: string;
  fallbackTo: string | null;
  domain: string;
}

export type InboundOutcome =
  | { status: 200; outcome: "stored"; communicationId: string; forwarded: true }
  | { status: 200; outcome: "stored_auto" | "stored_no_recipient"; communicationId: string; forwarded: false }
  | { status: 200; outcome: "duplicate" }
  | { status: 200; outcome: "fallback" | "dropped" }
  | { status: 502; outcome: "forward_failed"; communicationId?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for auto-replies, out-of-office messages, bounces and list mail. */
export function isAutoMessage(mail: ParsedMail, envelopeFrom?: string | null): boolean {
  const auto = (mail.header("auto-submitted") || "").trim().toLowerCase();
  if (auto && auto !== "no") return true;
  const precedence = (mail.header("precedence") || "").trim().toLowerCase();
  if (["bulk", "junk", "list", "auto_reply"].includes(precedence)) return true;
  if (mail.header("x-autoreply") || mail.header("x-autorespond") || mail.header("x-auto-response-suppress")?.match(/all|oof|autoreply/i)) return true;
  if ((mail.header("content-type") || "").toLowerCase().includes("multipart/report")) return true;
  if (envelopeFrom !== undefined && envelopeFrom !== null && /^<?>?$/.test(envelopeFrom.trim())) return true;
  const from = mail.from?.address ?? "";
  if (!from) return true;
  const local = from.split("@")[0];
  return /^(mailer-daemon|postmaster|no-?reply|do-?not-?reply)$/i.test(local);
}

/** Spam and authentication verdict headers, as set by the receiving server. */
function spamHeaders(mail: ParsedMail): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const name of ["x-spam-status", "x-spam-flag", "x-spam-score", "x-cf-spamh-score", "authentication-results", "received-spf"]) {
    const v = mail.header(name);
    if (v) out[name] = v.slice(0, 500);
  }
  return Object.keys(out).length ? out : undefined;
}

/** The reply address the message was sent to: the envelope recipient first, then the headers. */
function findReplyToken(mail: ParsedMail, envelopeTo: string | null | undefined, domain: string) {
  const candidates = [
    envelopeTo ?? "",
    ...(mail.headers.get("delivered-to") ?? []),
    ...(mail.headers.get("x-original-to") ?? []),
    ...mail.to.map((a) => a.address),
    ...mail.cc.map((a) => a.address),
  ];
  for (const c of candidates) {
    const parsed = parseReplyAddress(c, domain);
    if (parsed) return parsed;
  }
  return null;
}

/** Our own Message-IDs are <communication-id@domain>. */
function ownCommunicationIds(mail: ParsedMail, domain: string): string[] {
  const ids: string[] = [];
  for (const ref of [mail.inReplyTo, ...[...mail.references].reverse()]) {
    if (!ref) continue;
    const m = /^<([^@>]+)@([^>]+)>$/.exec(ref);
    if (m && m[2].toLowerCase() === domain && UUID_RE.test(m[1]) && !ids.includes(m[1].toLowerCase())) ids.push(m[1].toLowerCase());
  }
  return ids;
}

type Lang = "en" | "nl" | "fr" | "de";

const FORWARD_TEXT: Record<Lang, {
  intro: (who: string, property: string) => string;
  open: string;
  unknown: string;
  answer: (name: string) => string;
  attached: string;
  notAttached: string;
  noText: string;
}> = {
  en: {
    intro: (who, property) => `${who} replied about the contract for ${property}.`,
    open: "Open the contract",
    unknown: "Careful: this address is not one of the tenants on this contract. Check who wrote before you act on it.",
    answer: (name) => `Answer this email to reply to ${name} directly.`,
    attached: "Attachments",
    notAttached: "Not attached, too large (still with the original message)",
    noText: "(no text in the message)",
  },
  nl: {
    intro: (who, property) => `${who} heeft geantwoord over het contract voor ${property}.`,
    open: "Open het contract",
    unknown: "Let op: dit adres hoort niet bij een huurder van dit contract. Kijk na wie dit schreef voor je er iets mee doet.",
    answer: (name) => `Beantwoord deze e-mail om ${name} rechtstreeks te antwoorden.`,
    attached: "Bijlagen",
    notAttached: "Niet bijgevoegd, te groot (zit nog bij het oorspronkelijke bericht)",
    noText: "(geen tekst in het bericht)",
  },
  fr: {
    intro: (who, property) => `${who} a répondu au sujet du contrat pour ${property}.`,
    open: "Ouvrir le contrat",
    unknown: "Attention : cette adresse n'est pas celle d'un locataire de ce contrat. Vérifiez qui a écrit avant d'y donner suite.",
    answer: (name) => `Répondez à cet e-mail pour répondre directement à ${name}.`,
    attached: "Pièces jointes",
    notAttached: "Non jointes, trop volumineuses (toujours avec le message d'origine)",
    noText: "(pas de texte dans le message)",
  },
  de: {
    intro: (who, property) => `${who} hat zum Vertrag für ${property} geantwortet.`,
    open: "Vertrag öffnen",
    unknown: "Achtung: Diese Adresse gehört zu keinem Mieter dieses Vertrags. Prüfen Sie, wer geschrieben hat, bevor Sie darauf reagieren.",
    answer: (name) => `Antworten Sie auf diese E-Mail, um ${name} direkt zu antworten.`,
    attached: "Anhänge",
    notAttached: "Nicht angehängt, zu groß (noch bei der ursprünglichen Nachricht)",
    noText: "(kein Text in der Nachricht)",
  },
};

function lang(locale: string | null | undefined): Lang {
  const l = (locale || "en").slice(0, 2).toLowerCase();
  return l === "nl" || l === "fr" || l === "de" ? l : "en";
}

function who(a: MailAddress | null): string {
  if (!a) return "?";
  return a.name ? `${a.name} <${a.address}>` : a.address;
}

/** Re: <subject>, with the property name in front when it is not in there yet. */
export function forwardSubject(subject: string, propertyName: string): string {
  const base = subject.trim() || "(no subject)";
  const re = /^(re|antw|aw|réf|ref|sv|wg|tr|fw|fwd)\s*:/i.test(base) ? base : `Re: ${base}`;
  return propertyName && !re.toLowerCase().includes(propertyName.toLowerCase()) ? `[${propertyName}] ${re}` : re;
}

export async function processInboundEmail(
  raw: Buffer,
  envelope: { to?: string | null; from?: string | null },
  deps: InboundDeps,
): Promise<InboundOutcome> {
  const mail = parseMail(raw);
  const parsed = findReplyToken(mail, envelope.to, deps.domain);
  const leaseId = parsed ? await deps.resolveToken(parsed.leaseToken) : null;
  const lease = leaseId ? await deps.loadLease(leaseId) : null;

  if (!lease) {
    return sendToFallback(raw, mail, envelope, deps);
  }

  if (mail.messageId && (await deps.hasMessageId(lease.id, mail.messageId))) {
    return { status: 200, outcome: "duplicate" };
  }

  const matched = await deps.findCommunication(lease.id, {
    tag: parsed?.messageTag ?? null,
    ids: ownCommunicationIds(mail, deps.domain),
  });

  const sender = mail.from;
  const senderAddress = sender?.address ?? null;
  const known = new Set((await deps.tenantEmails(lease.id)).map((e) => e.trim().toLowerCase()));
  if (matched) {
    if (matched.recipientEmail) known.add(matched.recipientEmail.toLowerCase());
    for (const c of matched.cc) known.add(c.toLowerCase());
  }
  const senderKnown = !!senderAddress && known.has(senderAddress);
  const auto = isAutoMessage(mail, envelope.from);

  const rawText = mail.text ?? (mail.html ? htmlToText(mail.html) : "");
  const { text, trimmed } = trimQuotedReply(rawText);
  const attachments = mail.attachments.map((a) => ({ name: a.filename, size: a.size, type: a.contentType }));

  const metadata: Record<string, unknown> = {
    from: sender,
    to: mail.to,
    ...(mail.cc.length ? { cc: mail.cc.map((a) => a.address) } : {}),
    messageId: mail.messageId,
    inReplyTo: mail.inReplyTo,
    ...(matched ? { matchedCommunicationId: matched.id } : {}),
    ...(attachments.length ? { attachments } : {}),
    ...(spamHeaders(mail) ? { spam: spamHeaders(mail) } : {}),
    senderKnown,
    ...(auto ? { auto: true } : {}),
    ...(trimmed ? { fullText: rawText.slice(0, MAX_BODY_CHARS) } : {}),
    ...(envelope.from ? { envelopeFrom: envelope.from } : {}),
  };

  const communicationId = await deps.insertInbound({
    ownerId: lease.ownerId,
    leaseId: lease.id,
    senderName: (sender?.name || senderAddress || "?").slice(0, 255),
    senderEmail: senderAddress,
    subject: mail.subject.slice(0, 500),
    body: text.slice(0, MAX_BODY_CHARS),
    sentAt: mail.date ?? new Date(),
    metadata,
  });

  if (auto) return { status: 200, outcome: "stored_auto", communicationId, forwarded: false };

  const recipients = await deps.managers(lease.propertyId, lease.ownerEmail);
  if (!recipients.to) {
    console.warn(`[Inbound] no one to forward the reply on lease ${lease.id} to`);
    return { status: 200, outcome: "stored_no_recipient", communicationId, forwarded: false };
  }

  const l = FORWARD_TEXT[lang(lease.ownerLocale)];
  const senderName = sender?.name || senderAddress || "?";
  const kept: EmailOptions["attachments"] = [];
  const skipped: string[] = [];
  let total = 0;
  for (const a of mail.attachments) {
    if (total + a.size > MAX_FORWARD_ATTACHMENTS_BYTES) {
      skipped.push(a.filename);
      continue;
    }
    total += a.size;
    kept.push({ filename: a.filename, content: a.content, contentType: a.contentType });
  }
  const lines = [
    l.intro(who(sender), lease.propertyName),
    `${l.open}: ${deps.webUrl.replace(/\/$/, "")}/leases/${lease.id}`,
    ...(senderKnown ? [] : ["", l.unknown]),
    "",
    l.answer(senderName),
    ...(attachments.length ? ["", `${l.attached}: ${attachments.map((a) => a.name).join(", ")}`] : []),
    ...(skipped.length ? [`${l.notAttached}: ${skipped.join(", ")}`] : []),
    "",
    "--------",
    "",
    text || l.noText,
  ];

  try {
    await deps.sendForward(
      {
        to: recipients.to,
        cc: recipients.cc,
        subject: forwardSubject(mail.subject, lease.propertyName),
        body: lines.join("\n"),
        replyTo: senderAddress ? (sender?.name ? `"${sender.name.replace(/"/g, "")}" <${senderAddress}>` : senderAddress) : undefined,
        inReplyTo: mail.messageId ?? undefined,
        references: mail.messageId ? [mail.messageId] : undefined,
        attachments: kept.length ? kept : undefined,
      },
      {
        ownerId: lease.ownerId,
        leaseId: lease.id,
        metadata: { kind: "tenant_reply_forward", inboundId: communicationId, replyTo: senderAddress, senderKnown },
      },
    );
  } catch (err) {
    console.error(`[Inbound] forwarding the reply on lease ${lease.id} failed:`, err);
    return { status: 502, outcome: "forward_failed", communicationId };
  }
  return { status: 200, outcome: "stored", communicationId, forwarded: true };
}

async function sendToFallback(
  raw: Buffer,
  mail: ParsedMail,
  envelope: { to?: string | null; from?: string | null },
  deps: InboundDeps,
): Promise<InboundOutcome> {
  if (!deps.fallbackTo) {
    console.warn(`[Inbound] reply to unknown address ${envelope.to ?? "?"} dropped: no INBOUND_FALLBACK_TO or ADMIN_EMAIL`);
    return { status: 200, outcome: "dropped" };
  }
  try {
    await deps.sendPlain({
      to: deps.fallbackTo,
      subject: `[Rentular] Reply to an unknown address: ${mail.subject || "(no subject)"}`.slice(0, 500),
      body: [
        "A message came in on a reply address that does not belong to any contract (unknown or revoked token).",
        "The original message is attached.",
        "",
        `From: ${who(mail.from)}`,
        `To: ${envelope.to || mail.to.map((a) => a.address).join(", ")}`,
        `Subject: ${mail.subject}`,
      ].join("\n"),
      attachments: [{ filename: "original.eml", content: raw, contentType: "message/rfc822" }],
    });
  } catch (err) {
    console.error("[Inbound] fallback forward failed:", err);
    return { status: 502, outcome: "forward_failed" };
  }
  return { status: 200, outcome: "fallback" };
}

/** Production wiring of the dependencies. */
export function defaultInboundDeps(): InboundDeps {
  const db = getDb();
  return {
    resolveToken: (token) => resolveLeaseReplyToken(token, db),
    loadLease: async (leaseId) => {
      const row = (
        await db
          .select({
            id: leases.id,
            ownerId: leases.ownerId,
            propertyId: leases.propertyId,
            propertyName: properties.name,
            ownerEmail: users.email,
            ownerLocale: users.locale,
          })
          .from(leases)
          .innerJoin(properties, eq(properties.id, leases.propertyId))
          .leftJoin(users, eq(users.id, leases.ownerId))
          .where(eq(leases.id, leaseId))
          .limit(1)
      )[0];
      return row ? { ...row, ownerEmail: row.ownerEmail ?? null, ownerLocale: row.ownerLocale ?? null } : null;
    },
    tenantEmails: async (leaseId) => {
      const rec = await getLeaseEmailRecipients(leaseId);
      return [rec.to, ...rec.ccEmails].filter((e): e is string => !!e);
    },
    hasMessageId: async (leaseId, messageId) => {
      const rows = await db
        .select({ id: communications.id })
        .from(communications)
        .where(
          and(
            eq(communications.leaseId, leaseId),
            eq(communications.direction, "inbound"),
            sql`JSON_UNQUOTE(JSON_EXTRACT(${communications.metadata}, '$.messageId')) = ${messageId}`,
          ),
        )
        .limit(1);
      return rows.length > 0;
    },
    findCommunication: async (leaseId, by) => {
      const pick = async (cond: ReturnType<typeof and>) =>
        (
          await db
            .select({ id: communications.id, recipientEmail: communications.recipientEmail, metadata: communications.metadata })
            .from(communications)
            .where(and(eq(communications.leaseId, leaseId), eq(communications.direction, "outbound"), cond))
            .limit(1)
        )[0];
      let row = by.tag && /^[0-9a-f]{8}$/.test(by.tag) ? await pick(and(like(communications.id, `${by.tag}%`))) : undefined;
      if (!row && by.ids.length) row = await pick(and(inArray(communications.id, by.ids)));
      if (!row) return null;
      const meta = (typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata) as Record<string, unknown> | null;
      const cc = Array.isArray(meta?.cc) ? (meta!.cc as unknown[]).filter((x): x is string => typeof x === "string") : [];
      return { id: row.id, recipientEmail: row.recipientEmail, cc };
    },
    insertInbound: async (row) => {
      const id = crypto.randomUUID();
      await db.insert(communications).values({
        id,
        ownerId: row.ownerId,
        leaseId: row.leaseId,
        channel: "email",
        type: "tenant_reply",
        direction: "inbound",
        recipientName: row.senderName,
        recipientEmail: row.senderEmail,
        subject: row.subject,
        body: row.body,
        status: "delivered",
        metadata: row.metadata,
        queuedAt: row.sentAt,
        sentAt: row.sentAt,
      });
      return id;
    },
    managers: (propertyId, ownerEmail) => getLandlordNotificationRecipients(propertyId, ownerEmail),
    sendForward: (options, log) =>
      sendEmailLogged(options, {
        ownerId: log.ownerId,
        leaseId: log.leaseId,
        type: "landlord_notification",
        recipientName: ccList(options.to)?.[0] ?? options.to,
        metadata: log.metadata,
      }),
    sendPlain: (options) => sendEmail(options),
    webUrl: process.env.WEB_URL || "https://rentular.com",
    fallbackTo: process.env.INBOUND_FALLBACK_TO || process.env.ADMIN_EMAIL || null,
    domain: replyDomain(),
  };
}
