import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { DEFAULT_EMAIL_TEMPLATES, REMINDER_DEFAULTS, DEFAULT_INTEREST_RATE, DEFAULT_LANDLORD_REPORT_DAYS } from "@rentular/shared";

export const settingsRouter = new Hono();

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
    // TODO: Update users.locale for the authenticated user
    return c.json({ locale, message: "Language preference saved" });
  }
);

// Get payment follow-up settings for the current owner
settingsRouter.get("/payment-follow-up", async (c) => {
  // TODO: Fetch from paymentFollowUpSettings table for the authenticated user
  // Return defaults if no settings exist yet
  return c.json({
    data: {
      enabled: true,
      friendlyReminderDays: REMINDER_DEFAULTS.friendly,
      formalReminderDays: REMINDER_DEFAULTS.formal,
      finalReminderDays: REMINDER_DEFAULTS.final,
      interestEnabled: false,
      annualInterestRate: DEFAULT_INTEREST_RATE,
      friendlySubject: DEFAULT_EMAIL_TEMPLATES.friendly.subject,
      friendlyBody: DEFAULT_EMAIL_TEMPLATES.friendly.body,
      formalSubject: DEFAULT_EMAIL_TEMPLATES.formal.subject,
      formalBody: DEFAULT_EMAIL_TEMPLATES.formal.body,
      finalSubject: DEFAULT_EMAIL_TEMPLATES.final.subject,
      finalBody: DEFAULT_EMAIL_TEMPLATES.final.body,
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
    // TODO: Upsert into paymentFollowUpSettings table for the authenticated user
    return c.json({ data, message: "Payment follow-up settings updated" });
  }
);

// Reset payment follow-up settings to defaults
settingsRouter.post("/payment-follow-up/reset", async (c) => {
  // TODO: Delete the user's settings row (will fall back to defaults)
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
      amount: "€850.00",
      dueDate: "2026-03-01",
      propertyName: "Apartment 2B, Koningstraat 15",
      daysPastDue: "5",
      interestAmount: "€1.23",
      totalOwed: "€851.23",
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
  // TODO: Fetch from paymentFollowUpSettings for the authenticated user
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
    // TODO: Upsert landlord report settings (stored as CSV in landlordReportDays)
    return c.json({ data, message: "Landlord report settings updated" });
  }
);
