import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, users, paymentFollowUpSettings } from "@rentular/db";
import { getRequiredUserId } from "../lib/routeAuth";
import { DEFAULT_EMAIL_TEMPLATES, REMINDER_DEFAULTS, DEFAULT_INTEREST_RATE, DEFAULT_LANDLORD_REPORT_DAYS } from "@rentular/shared";

const db = getDb();

export const settingsRouter = new Hono();
const defaultEmailTemplates = DEFAULT_EMAIL_TEMPLATES.en;

// Update user locale preference (saved to user profile)
settingsRouter.put(
  "/locale",
  zValidator(
    "json",
    z.object({
      locale: z.enum(["nl", "fr", "en", "de"]),
    })
  ),
  async (c) => {
    const { locale } = c.req.valid("json");
    const ownerId = getRequiredUserId(c);
    await db.update(users).set({ locale }).where(eq(users.id, ownerId));
    return c.json({ locale, message: "Language preference saved" });
  }
);

// Get payment follow-up settings for the current owner
settingsRouter.get("/payment-follow-up", async (c) => {
  const ownerId = getRequiredUserId(c);
  const result = await db.select().from(paymentFollowUpSettings)
    .where(eq(paymentFollowUpSettings.ownerId, ownerId));
  if (result[0]) {
    return c.json({ data: result[0] });
  }
  // Return defaults if no settings exist yet
  return c.json({
    data: {
      enabled: true,
      friendlyReminderDays: REMINDER_DEFAULTS.friendly,
      formalReminderDays: REMINDER_DEFAULTS.formal,
      finalReminderDays: REMINDER_DEFAULTS.final,
      interestEnabled: false,
      annualInterestRate: DEFAULT_INTEREST_RATE,
      friendlySubject: defaultEmailTemplates.friendly.subject,
      friendlyBody: defaultEmailTemplates.friendly.body,
      formalSubject: defaultEmailTemplates.formal.subject,
      formalBody: defaultEmailTemplates.formal.body,
      finalSubject: defaultEmailTemplates.final.subject,
      finalBody: defaultEmailTemplates.final.body,
    },
  });
});

// Update payment follow-up settings
settingsRouter.put(
  "/payment-follow-up",
  zValidator(
    "json",
    z.object({
      enabled: z.boolean(),
      friendlyReminderDays: z.number().int().min(0).max(90),
      formalReminderDays: z.number().int().min(0).max(90),
      finalReminderDays: z.number().int().min(0).max(90),
      interestEnabled: z.boolean(),
      annualInterestRate: z.number().min(0).max(100),
      friendlySubject: z.string().min(1).max(500),
      friendlyBody: z.string().min(1),
      formalSubject: z.string().min(1).max(500),
      formalBody: z.string().min(1),
      finalSubject: z.string().min(1).max(500),
      finalBody: z.string().min(1),
    }).refine(
      (data) =>
        data.friendlyReminderDays <= data.formalReminderDays &&
        data.formalReminderDays <= data.finalReminderDays,
      {
        message: "Reminder days must be in ascending order (friendly <= formal <= final)",
      }
    )
  ),
  async (c) => {
    const data = c.req.valid("json");
    const ownerId = getRequiredUserId(c);
    const existing = await db.select().from(paymentFollowUpSettings)
      .where(eq(paymentFollowUpSettings.ownerId, ownerId));
    if (existing[0]) {
      await db.update(paymentFollowUpSettings).set({
        enabled: data.enabled,
        friendlyReminderDays: data.friendlyReminderDays,
        formalReminderDays: data.formalReminderDays,
        finalReminderDays: data.finalReminderDays,
        interestEnabled: data.interestEnabled,
        annualInterestRate: String(data.annualInterestRate),
        friendlySubject: data.friendlySubject,
        friendlyBody: data.friendlyBody,
        formalSubject: data.formalSubject,
        formalBody: data.formalBody,
        finalSubject: data.finalSubject,
        finalBody: data.finalBody,
      }).where(eq(paymentFollowUpSettings.ownerId, ownerId));
    } else {
      await db.insert(paymentFollowUpSettings).values({
        id: crypto.randomUUID(),
        ownerId,
        enabled: data.enabled,
        friendlyReminderDays: data.friendlyReminderDays,
        formalReminderDays: data.formalReminderDays,
        finalReminderDays: data.finalReminderDays,
        interestEnabled: data.interestEnabled,
        annualInterestRate: String(data.annualInterestRate),
        friendlySubject: data.friendlySubject,
        friendlyBody: data.friendlyBody,
        formalSubject: data.formalSubject,
        formalBody: data.formalBody,
        finalSubject: data.finalSubject,
        finalBody: data.finalBody,
      });
    }
    return c.json({ data, message: "Payment follow-up settings updated" });
  }
);

// Reset payment follow-up settings to defaults
settingsRouter.post("/payment-follow-up/reset", async (c) => {
  const ownerId = getRequiredUserId(c);
  await db.delete(paymentFollowUpSettings).where(eq(paymentFollowUpSettings.ownerId, ownerId));
  return c.json({ message: "Settings reset to defaults" });
});

// Preview an email template with sample data
settingsRouter.post(
  "/payment-follow-up/preview",
  zValidator(
    "json",
    z.object({
      subject: z.string(),
      body: z.string(),
    })
  ),
  async (c) => {
    const { subject, body } = c.req.valid("json");
    // Replace placeholders with sample data for preview
    const sampleVars: Record<string, string> = {
      tenantName: "Jan Janssens",
      amount: "EUR850.00",
      dueDate: "2026-03-01",
      propertyName: "Apartment 2B, Koningstraat 15",
      daysPastDue: "5",
      interestAmount: "EUR1.23",
      totalOwed: "EUR851.23",
      ownerName: "Property Owner",
    };

    const renderedSubject = subject.replace(
      /\{\{(\w+)\}\}/g,
      (_, key) => sampleVars[key] ?? ""
    );
    const renderedBody = body.replace(
      /\{\{(\w+)\}\}/g,
      (_, key) => sampleVars[key] ?? ""
    );

    return c.json({ subject: renderedSubject, body: renderedBody });
  }
);

// --- Landlord report settings ---

// Get landlord report settings
settingsRouter.get("/landlord-report", async (c) => {
  const ownerId = getRequiredUserId(c);
  const result = await db.select().from(paymentFollowUpSettings)
    .where(eq(paymentFollowUpSettings.ownerId, ownerId));
  if (result[0]) {
    const reportDays = result[0].landlordReportDays
      ? result[0].landlordReportDays.split(",").map(Number)
      : [...DEFAULT_LANDLORD_REPORT_DAYS];
    return c.json({
      data: {
        enabled: result[0].landlordReportEnabled,
        reportDays,
        skipIfAllPaid: result[0].landlordReportSkipIfAllPaid,
      },
    });
  }
  // Return defaults if no settings exist
  return c.json({
    data: {
      enabled: true,
      reportDays: [...DEFAULT_LANDLORD_REPORT_DAYS],
      skipIfAllPaid: false,
    },
  });
});

// Update landlord report settings
settingsRouter.put(
  "/landlord-report",
  zValidator(
    "json",
    z.object({
      enabled: z.boolean(),
      reportDays: z
        .array(z.number().int().min(1).max(28))
        .min(1)
        .max(28)
        .refine(
          (days) => new Set(days).size === days.length,
          { message: "Report days must be unique" }
        ),
      skipIfAllPaid: z.boolean(),
    })
  ),
  async (c) => {
    const data = c.req.valid("json");
    const ownerId = getRequiredUserId(c);
    const landlordReportDays = data.reportDays.join(",");
    const existing = await db.select().from(paymentFollowUpSettings)
      .where(eq(paymentFollowUpSettings.ownerId, ownerId));
    if (existing[0]) {
      await db.update(paymentFollowUpSettings).set({
        landlordReportEnabled: data.enabled,
        landlordReportDays,
        landlordReportSkipIfAllPaid: data.skipIfAllPaid,
      }).where(eq(paymentFollowUpSettings.ownerId, ownerId));
    } else {
      await db.insert(paymentFollowUpSettings).values({
        id: crypto.randomUUID(),
        ownerId,
        landlordReportEnabled: data.enabled,
        landlordReportDays,
        landlordReportSkipIfAllPaid: data.skipIfAllPaid,
      });
    }
    return c.json({ data, message: "Landlord report settings updated" });
  }
);
