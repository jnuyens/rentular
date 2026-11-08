import { createTransport, type Transporter } from "nodemailer";
import { getDb, smtpSettings } from "@rentular/db";
import { eq } from "drizzle-orm";
import { decrypt } from "./encryption";

/**
 * Options for the platform SMTP transport, read from the environment.
 *
 * SMTP_HOST / SMTP_PORT pick the relay (default localhost:1025, Mailpit).
 * SMTP_USER / SMTP_PASSWORD turn on SMTP AUTH for a remote relay.
 * SMTP_SECURE=true uses implicit TLS (usually port 465); when it is unset,
 * port 465 implies TLS and every other port uses STARTTLS when offered.
 *
 * Without credentials the relay is assumed to be a trusted local one (postfix
 * on the host), which presents a certificate for its own hostname rather than
 * 127.0.0.1, so certificate checking is relaxed for that case only. With
 * credentials the certificate is verified normally.
 */
export function buildPlatformTransportOptions(env: NodeJS.ProcessEnv = process.env): {
  host: string;
  port: number;
  secure: boolean;
  auth?: { user: string; pass: string };
  tls?: { rejectUnauthorized: boolean };
} {
  const host = env.SMTP_HOST || "localhost";
  const port = Number(env.SMTP_PORT) || 1025;
  const secureFlag = (env.SMTP_SECURE || "").trim().toLowerCase();
  const secure = secureFlag ? secureFlag === "true" || secureFlag === "1" : port === 465;
  const user = env.SMTP_USER || "";
  if (user) {
    return { host, port, secure, auth: { user, pass: env.SMTP_PASSWORD || "" } };
  }
  return { host, port, secure, tls: { rejectUnauthorized: false } };
}

const defaultTransporter = createTransport(buildPlatformTransportOptions());

export interface EmailOptions {
  to: string;
  cc?: string;
  subject: string;
  body: string;
  // Optional HTML alternative. `body` stays the plain-text part and is what
  // gets logged to communications.
  html?: string;
  ownerId?: string;
  /** Reply-To header, e.g. the contract's reply address or the tenant who wrote in. */
  replyTo?: string;
  /** Message-ID to set (with angle brackets), so replies can be matched to it. */
  messageId?: string;
  /** In-Reply-To / References for a message that answers another one. */
  inReplyTo?: string;
  references?: string[];
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType: string;
  }>;
}

// Per-landlord SMTP transport cache with TTL-based expiry
const transportCache = new Map<string, { transport: Transporter; createdAt: number; fromAddress: string; fromName?: string }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Sender used for mail sent through the platform transport.
 * Defaults to "Rentular <noreply@rentular.com>". EMAIL_FROM_NAME overrides the
 * display name. If EMAIL_FROM already holds a full "Name <address>" value it is
 * used verbatim, without adding a second name.
 */
export function getPlatformSender(): { fromAddress: string; fromName?: string } {
  const fromAddress = process.env.EMAIL_FROM || "noreply@rentular.com";
  if (fromAddress.includes("<")) {
    return { fromAddress };
  }
  return { fromAddress, fromName: process.env.EMAIL_FROM_NAME || "Rentular" };
}

/**
 * Build the nodemailer "from" value. With a display name this is an address
 * object, so nodemailer quotes the name correctly and still uses the bare
 * address as the envelope sender.
 */
export function buildFromHeader(
  fromAddress: string,
  fromName?: string
): string | { name: string; address: string } {
  return fromName ? { name: fromName, address: fromAddress } : fromAddress;
}

/**
 * Get an SMTP transport for a specific owner. If the owner has custom SMTP settings,
 * returns a cached transport configured with their credentials. Otherwise falls back
 * to the platform default SMTP transport.
 */
export async function getTransportForOwner(ownerId?: string): Promise<{
  transport: Transporter;
  fromAddress: string;
  fromName?: string;
}> {
  if (!ownerId) {
    return { transport: defaultTransporter, ...getPlatformSender() };
  }

  // Check cache (transport + fromAddress/fromName stored together)
  const cached = transportCache.get(ownerId);
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    return {
      transport: cached.transport,
      fromAddress: cached.fromAddress,
      fromName: cached.fromName,
    };
  }

  // Look up SMTP settings from DB
  const db = getDb();
  const settings = await db.select().from(smtpSettings).where(eq(smtpSettings.ownerId, ownerId)).limit(1);

  if (!settings[0]) {
    return { transport: defaultTransporter, ...getPlatformSender() };
  }

  // Decrypt password and create transport
  const password = decrypt(settings[0].passwordEncrypted, settings[0].passwordIv, settings[0].passwordTag);
  const transport = createTransport({
    host: settings[0].host,
    port: settings[0].port,
    secure: settings[0].port === 465,
    auth: { user: settings[0].username, pass: password },
  });

  const fromName = settings[0].fromName || undefined;
  transportCache.set(ownerId, {
    transport,
    createdAt: Date.now(),
    fromAddress: settings[0].fromAddress,
    fromName,
  });
  console.log(`[Email] Created SMTP transport for owner ${ownerId} (${settings[0].host}:${settings[0].port})`);
  return { transport, fromAddress: settings[0].fromAddress, fromName };
}

/**
 * Clear the cached SMTP transport for an owner (called after settings change or deletion).
 */
export function clearTransportCache(ownerId: string): void {
  transportCache.delete(ownerId);
}

export async function sendEmail(options: EmailOptions): Promise<void> {
  const { transport, fromAddress, fromName } = await getTransportForOwner(options.ownerId);
  const from = buildFromHeader(fromAddress, fromName);
  await transport.sendMail({
    from,
    to: options.to,
    cc: options.cc || undefined,
    subject: options.subject,
    text: options.body,
    html: options.html || undefined,
    replyTo: options.replyTo || undefined,
    messageId: options.messageId || undefined,
    inReplyTo: options.inReplyTo || undefined,
    references: options.references && options.references.length ? options.references : undefined,
    attachments: options.attachments,
  });
}

// Replace template placeholders like {{tenantName}} with actual values
export function renderTemplate(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? "");
}
