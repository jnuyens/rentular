import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

export const indexationRouter = new Hono();

// Get current Belgian health index
indexationRouter.get("/health-index", async (c) => {
  // TODO: Fetch from Statbel API or cached value
  return c.json({
    currentIndex: 0,
    month: "",
    year: 0,
    source: "Statbel",
    lastUpdated: null,
  });
});

// Get health index history
indexationRouter.get("/health-index/history", async (c) => {
  const from = c.req.query("from");
  const to = c.req.query("to");
  return c.json({ data: [] });
});

// Calculate indexed rent for a specific lease
indexationRouter.get("/calculate/:leaseId", async (c) => {
  const leaseId = c.req.param("leaseId");

  // Belgian rent indexation formula:
  // New rent = (base rent * current health index) / base health index
  //
  // Where:
  // - base rent = rent at lease start (or last formal revision)
  // - base health index = health index of the month BEFORE the lease start month
  // - current health index = health index of the month BEFORE the anniversary month
  //
  // Indexation can only happen on the anniversary date of the lease
  // Regional differences:
  // - Flanders: automatic indexation allowed
  // - Wallonia: landlord must request it within 3 months of anniversary
  // - Brussels: similar to Wallonia, with energy performance restrictions

  return c.json({
    leaseId,
    baseRent: 0,
    baseIndex: 0,
    currentIndex: 0,
    newRent: 0,
    difference: 0,
    effectiveDate: null,
    region: null,
    formula: "newRent = baseRent * (currentIndex / baseIndex)",
  });
});

// Bulk calculate all upcoming indexations
indexationRouter.get("/upcoming", async (c) => {
  const days = Number(c.req.query("days")) || 30;
  return c.json({ data: [], period: `next ${days} days` });
});

// Preview the indexation notification email before sending
// Landlord can edit subject/body and optionally lower the new rent
indexationRouter.post(
  "/preview/:leaseId",
  zValidator(
    "json",
    z.object({
      // Landlord can override the calculated rent to any lower amount
      overrideNewRent: z.number().positive().optional(),
      // Custom email content (defaults generated from calculation)
      subject: z.string().optional(),
      body: z.string().optional(),
    })
  ),
  async (c) => {
    const leaseId = c.req.param("leaseId");
    const { overrideNewRent, subject, body } = c.req.valid("json");

    // TODO:
    // 1. Calculate the indexed rent using the formula
    // 2. If overrideNewRent is provided and <= calculated new rent, use that instead
    // 3. Generate default email subject/body with all details
    // 4. Return preview with rendered placeholders

    const calculatedNewRent = 0; // TODO: actual calculation
    const finalNewRent = overrideNewRent
      ? Math.min(overrideNewRent, calculatedNewRent)
      : calculatedNewRent;

    const defaultSubject = subject || "Rent indexation notification";
    const defaultBody = body || `Dear {{tenantName}},

We would like to inform you about the annual rent indexation for your property at {{propertyName}}.

Based on the Belgian health index:
- Current rent: {{currentRent}}
- Base index: {{baseIndex}}
- Current index: {{currentIndex}}
- New indexed rent: {{newRent}}
- Effective date: {{effectiveDate}}

Formula: new rent = base rent x (current index / base index)

This adjustment is in accordance with Belgian rental law.

Kind regards,
{{ownerName}}`;

    return c.json({
      leaseId,
      calculatedNewRent,
      finalNewRent,
      subject: defaultSubject,
      body: defaultBody,
    });
  }
);

// Apply indexation to a lease and send notification to tenant
// Landlord has full control: can customize the email and set rent to any amount <= calculated
indexationRouter.post(
  "/apply/:leaseId",
  zValidator(
    "json",
    z.object({
      // The rent to apply (must be <= calculated indexed rent; landlord can choose to be generous)
      newRent: z.number().positive(),
      // Fully customized notification email
      subject: z.string().min(1),
      body: z.string().min(1),
      // Whether to send the notification email to the tenant
      sendNotification: z.boolean().default(true),
    })
  ),
  async (c) => {
    const leaseId = c.req.param("leaseId");
    const { newRent, subject, body, sendNotification } = c.req.valid("json");

    // TODO:
    // 1. Verify newRent <= calculated indexed rent (landlord can lower, not raise beyond index)
    // 2. Update lease: currentMonthlyRent = newRent, lastIndexationDate = today
    // 3. Create indexationRecord with status 'applied'
    // 4. If sendNotification, render and send the customized email to tenant
    // 5. Update indexationRecord.notificationSentAt

    return c.json({
      message: "Indexation applied",
      leaseId,
      newRent,
      notificationSent: sendNotification,
    });
  }
);
