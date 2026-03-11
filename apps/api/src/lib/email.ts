import { createTransport } from "nodemailer";

const transporter = createTransport({
  host: process.env.SMTP_HOST || "localhost",
  port: Number(process.env.SMTP_PORT) || 1025,
  secure: false,
});

export interface EmailOptions {
  to: string;
  subject: string;
  body: string;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType: string;
  }>;
}

export async function sendEmail(options: EmailOptions): Promise<void> {
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || "noreply@rentular.com",
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
