import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import bcrypt from "bcrypt";
import { randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { getDb, passwordResetTokens, users } from "@rentular/db";
import { sendEmail } from "../lib/email";
import { getRequiredUserId, requireAuth } from "../lib/routeAuth";

export const authRouter = new Hono();

const MIN_PASSWORD_LENGTH = 12;
const PASSWORD_SALT_ROUNDS = 12;
const db = getDb();

authRouter.use("/email", requireAuth);
authRouter.use("/password", requireAuth);

function buildAppUrl(path: string): string {
  const baseUrl = process.env.AUTH_URL || process.env.WEB_URL || "http://localhost:3000";
  return new URL(path, baseUrl).toString();
}

// Register a new user with email/password
authRouter.post(
  "/register",
  zValidator(
    "json",
    z.object({
      email: z.string().email(),
      password: z.string().min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`),
      name: z.string().optional(),
    })
  ),
  async (c) => {
    const { email, password, name } = c.req.valid("json");
    const normalizedEmail = email.trim().toLowerCase();
    const existingUser = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    if (existingUser[0]) {
      return c.json({ error: "An account with this email already exists" }, 409);
    }

    const userId = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(password, PASSWORD_SALT_ROUNDS);

    await db.insert(users).values({
      id: userId,
      email: normalizedEmail,
      name: name || null,
      passwordHash,
    });

    try {
      await sendEmail({
        to: normalizedEmail,
        subject: "Your Rentular account is ready",
        body: `Hello${name ? ` ${name}` : ""},\n\nYour Rentular account has been created successfully.\n\nYou can sign in at ${buildAppUrl("/login")}.\n`,
      });
    } catch (err) {
      console.error("[Auth] Failed to send welcome email:", err);
    }

    return c.json({ message: "Account created" }, 201);
  }
);

// Request password reset
authRouter.post(
  "/forgot-password",
  zValidator(
    "json",
    z.object({
      email: z.string().email(),
    })
  ),
  async (c) => {
    const { email } = c.req.valid("json");
    const normalizedEmail = email.trim().toLowerCase();
    const existingUser = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    const user = existingUser[0];
    if (user) {
      const token = randomBytes(32).toString("hex");
      const expires = new Date(Date.now() + 60 * 60 * 1000);

      await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id));
      await db.insert(passwordResetTokens).values({
        id: crypto.randomUUID(),
        userId: user.id,
        token,
        expires,
      });

      const resetUrl = buildAppUrl(`/login?resetToken=${encodeURIComponent(token)}`);

      try {
        await sendEmail({
          to: user.email,
          subject: "Reset your Rentular password",
          body: `Hello${user.name ? ` ${user.name}` : ""},\n\nUse the link below to reset your password. This link expires in 1 hour.\n\n${resetUrl}\n`,
        });
      } catch (err) {
        console.error("[Auth] Failed to send password reset email:", err);
      }
    }

    return c.json({ message: "If an account exists, a reset link has been sent" });
  }
);

// Reset password with token
authRouter.post(
  "/reset-password",
  zValidator(
    "json",
    z.object({
      token: z.string(),
      password: z.string().min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`),
    })
  ),
  async (c) => {
    const { token, password } = c.req.valid("json");
    const now = new Date();
    const tokenRows = await db
      .select()
      .from(passwordResetTokens)
      .where(and(eq(passwordResetTokens.token, token), gt(passwordResetTokens.expires, now)))
      .limit(1);

    const resetToken = tokenRows[0];
    if (!resetToken) {
      return c.json({ error: "Reset token is invalid or expired" }, 400);
    }

    const passwordHash = await bcrypt.hash(password, PASSWORD_SALT_ROUNDS);

    await db.update(users).set({ passwordHash }).where(eq(users.id, resetToken.userId));
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.id, resetToken.id));

    return c.json({ message: "Password updated" });
  }
);

// Change email address (authenticated)
authRouter.put(
  "/email",
  zValidator(
    "json",
    z.object({
      newEmail: z.string().email(),
      password: z.string().min(1, "Current password required"),
    })
  ),
  async (c) => {
    const { newEmail, password } = c.req.valid("json");
    const userId = getRequiredUserId(c);
    const existingUser = await db.select().from(users).where(eq(users.id, userId)).limit(1);

    const user = existingUser[0];
    if (!user?.passwordHash) {
      return c.json({ error: "Password login is not enabled for this account" }, 400);
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      return c.json({ error: "Current password is incorrect" }, 400);
    }

    const normalizedEmail = newEmail.trim().toLowerCase();
    const duplicate = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    if (duplicate[0] && duplicate[0].id !== userId) {
      return c.json({ error: "That email address is already in use" }, 409);
    }

    await db
      .update(users)
      .set({ email: normalizedEmail, emailVerified: null })
      .where(eq(users.id, userId));

    try {
      await sendEmail({
        to: normalizedEmail,
        subject: "Your Rentular email address has changed",
        body: `Hello${user.name ? ` ${user.name}` : ""},\n\nYour account email was updated to this address. If you did not request this change, contact support immediately.\n`,
      });
    } catch (err) {
      console.error("[Auth] Failed to send email change notice:", err);
    }

    return c.json({ message: "Email updated. Please verify your new email address." });
  }
);

// Change password (authenticated)
authRouter.put(
  "/password",
  zValidator(
    "json",
    z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`),
    })
  ),
  async (c) => {
    const { currentPassword, newPassword } = c.req.valid("json");
    const userId = getRequiredUserId(c);
    const existingUser = await db.select().from(users).where(eq(users.id, userId)).limit(1);

    const user = existingUser[0];
    if (!user?.passwordHash) {
      return c.json({ error: "Password login is not enabled for this account" }, 400);
    }

    const passwordMatches = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!passwordMatches) {
      return c.json({ error: "Current password is incorrect" }, 400);
    }

    const passwordHash = await bcrypt.hash(newPassword, PASSWORD_SALT_ROUNDS);
    await db.update(users).set({ passwordHash }).where(eq(users.id, userId));

    return c.json({ message: "Password changed" });
  }
);
