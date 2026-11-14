import { sendEmail } from "./email";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

/**
 * Send a notification email to the admin when a new user signs up.
 * Fires and forgets — errors are logged but never block the signup flow.
 */
export function notifyNewUserSignup(
  userEmail: string,
  userName?: string,
  method: "email" | "oauth" = "email",
): void {
  if (!ADMIN_EMAIL) return;

  const subject = `New Rentular signup: ${userEmail}`;
  const body = [
    `A new user has signed up for Rentular.`,
    ``,
    `Email: ${userEmail}`,
    userName ? `Name: ${userName}` : null,
    `Method: ${method === "oauth" ? "Google OAuth" : "Email/password"}`,
    `Time: ${new Date().toISOString()}`,
  ]
    .filter(Boolean)
    .join("\n");

  sendEmail({ to: ADMIN_EMAIL, subject, body }).catch((err) => {
    console.error("[AdminNotify] Failed to send new user notification:", err);
  });
}

/**
 * Send an operational alert to the admin. Unlike the signup notice this
 * rejects on failure, so a caller can retry later.
 */
export async function sendAdminEmail(to: string, subject: string, body: string): Promise<void> {
  await sendEmail({ to, subject, body });
}
