import { createTransport, type Transporter } from "nodemailer";
import { getDb, smtpSettings } from "@rentular/db";
import { eq } from "drizzle-orm";
import { decrypt } from "./encryption";

const defaultTransporter = createTransport({
  host: process.env.SMTP_HOST || "localhost",
  port: Number(process.env.SMTP_PORT) || 1025,
  secure: false,
});

export interface EmailOptions {
  to: string;
  subject: string;
  body: string;
  ownerId?: string;
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
    return {
      transport: defaultTransporter,
      fromAddress: process.env.EMAIL_FROM || "noreply@rentular.com",
    };
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
    return {
      transport: defaultTransporter,
      fromAddress: process.env.EMAIL_FROM || "noreply@rentular.com",
    };
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
  const from = fromName ? `"${fromName}" <${fromAddress}>` : fromAddress;
  await transport.sendMail({
    from,
    to: options.to,
    subject: options.subject,
    text: options.body,
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
