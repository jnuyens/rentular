import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { getDb, tenants, leases } from "@rentular/db";
import {
  isGoCardlessConfigured,
  createMandateSetupFlow,
  getMandate,
  cancelMandate,
  createCustomer,
} from "../lib/gocardless";
import { getRequiredUserId } from "../lib/routeAuth";

export const gocardlessRouter = new Hono();

// Check if GoCardless is configured
gocardlessRouter.get("/status", async (c) => {
  return c.json({
    configured: isGoCardlessConfigured(),
    environment: process.env.GOCARDLESS_ENVIRONMENT || "sandbox",
  });
});

// Start mandate setup flow for a tenant
// Returns a redirect URL the tenant visits to authorise the SEPA direct debit
gocardlessRouter.post(
  "/mandates/setup",
  zValidator(
    "json",
    z.object({
      tenantId: z.string().uuid(),
      leaseId: z.string().uuid(),
      // Tenant details (passed from frontend, which has the tenant record)
      tenantEmail: z.string().email(),
      tenantFirstName: z.string().min(1),
      tenantLastName: z.string().min(1),
      // Optional: if tenant already has a GoCardless customer ID
      gocardlessCustomerId: z.string().optional(),
      // URL to redirect tenant after mandate authorisation
      redirectUrl: z.string().url(),
    })
  ),
  async (c) => {
    if (!isGoCardlessConfigured()) {
      return c.json(
        { error: "GoCardless is not configured. Set GOCARDLESS_ACCESS_TOKEN." },
        503
      );
    }

    const data = c.req.valid("json");

    // Ownership check: verify lease belongs to authenticated user
    const ownerId = getRequiredUserId(c);
    const db = getDb();
    const lease = await db.query.leases.findFirst({
      where: and(eq(leases.id, data.leaseId), eq(leases.ownerId, ownerId)),
    });
    if (!lease) {
      return c.json({ error: "Lease not found" }, 404);
    }

    try {
      const result = await createMandateSetupFlow({
        tenantEmail: data.tenantEmail,
        tenantFirstName: data.tenantFirstName,
        tenantLastName: data.tenantLastName,
        customerId: data.gocardlessCustomerId,
        description: `Rent payment mandate for lease ${data.leaseId}`,
        redirectUrl: data.redirectUrl,
        metadata: {
          tenant_id: data.tenantId,
          lease_id: data.leaseId,
        },
      });

      return c.json({
        data: {
          flowId: result.flowId,
          authorisationUrl: result.authorisationUrl,
          customerId: result.customerId,
        },
        message:
          "Mandate setup flow created. Redirect the tenant to authorisationUrl.",
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to create mandate flow";
      console.error("[GoCardless] Mandate setup error:", err);
      return c.json({ error: message }, 500);
    }
  }
);

// Complete mandate setup - called after tenant returns from GoCardless redirect
// The billing request flow will have created a mandate; we need to look it up
gocardlessRouter.post(
  "/mandates/complete",
  zValidator(
    "json",
    z.object({
      tenantId: z.string().uuid(),
      leaseId: z.string().uuid(),
      billingRequestId: z.string().optional(),
      // GoCardless returns the mandate ID as a query param on redirect
      mandateId: z.string().optional(),
    })
  ),
  async (c) => {
    if (!isGoCardlessConfigured()) {
      return c.json(
        { error: "GoCardless is not configured." },
        503
      );
    }

    const data = c.req.valid("json");

    if (!data.mandateId) {
      return c.json(
        { error: "mandateId is required after redirect completion." },
        400
      );
    }

    try {
      // Verify the mandate exists and is active/pending
      const mandate = await getMandate(data.mandateId);

      if (!mandate || !["pending_submission", "submitted", "active"].includes(mandate.status!)) {
        return c.json(
          {
            error: `Mandate is not in a valid state: ${mandate?.status}`,
          },
          400
        );
      }

      // Persist GoCardless IDs to database
      const ownerId = getRequiredUserId(c);
      const db = getDb();

      // Verify lease belongs to this owner
      const lease = await db.query.leases.findFirst({
        where: and(eq(leases.id, data.leaseId), eq(leases.ownerId, ownerId)),
      });
      if (!lease) {
        return c.json({ error: "Lease not found" }, 404);
      }

      // Update lease with mandate ID
      await db
        .update(leases)
        .set({
          gocardlessMandateId: mandate.id,
          paymentMethod: "gocardless",
          updatedAt: new Date(),
        })
        .where(eq(leases.id, data.leaseId));

      // Update tenant with mandate ID and customer ID
      await db
        .update(tenants)
        .set({
          gocardlessMandateId: mandate.id,
          gocardlessCustomerId: mandate.links?.customer || null,
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, data.tenantId));

      console.log(
        `[GoCardless] Mandate ${mandate.id} linked to lease ${data.leaseId} and tenant ${data.tenantId}`
      );

      return c.json({
        data: {
          mandateId: mandate.id,
          mandateStatus: mandate.status,
          customerId: mandate.links?.customer,
          scheme: mandate.scheme,
          bankAccount: mandate.links?.customer_bank_account,
        },
        message: "Mandate setup completed. Direct debit is now active.",
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to complete mandate setup";
      console.error("[GoCardless] Mandate complete error:", err);
      return c.json({ error: message }, 500);
    }
  }
);

// Get mandate status
gocardlessRouter.get("/mandates/:mandateId", async (c) => {
  if (!isGoCardlessConfigured()) {
    return c.json({ error: "GoCardless is not configured." }, 503);
  }

  const mandateId = c.req.param("mandateId");

  try {
    const mandate = await getMandate(mandateId);
    return c.json({
      data: {
        id: mandate.id,
        status: mandate.status,
        scheme: mandate.scheme,
        reference: mandate.reference,
        nextPossibleChargeDate: mandate.next_possible_charge_date,
        createdAt: mandate.created_at,
      },
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to fetch mandate";
    return c.json({ error: message }, 500);
  }
});

// Cancel a mandate
gocardlessRouter.post("/mandates/:mandateId/cancel", async (c) => {
  if (!isGoCardlessConfigured()) {
    return c.json({ error: "GoCardless is not configured." }, 503);
  }

  const mandateId = c.req.param("mandateId");

  try {
    const mandate = await cancelMandate(mandateId);

    const db = getDb();

    // Flag affected leases with a visible note before clearing mandate (D-13)
    const affectedLeases = await db
      .select({ id: leases.id, notes: leases.notes })
      .from(leases)
      .where(eq(leases.gocardlessMandateId, mandateId));

    for (const lease of affectedLeases) {
      const flagNote = `Mandate ${mandateId} cancelled on ${new Date().toISOString().split("T")[0]} -- SEPA collection stopped, action required.`;
      const updatedNotes = lease.notes
        ? `${lease.notes}\n${flagNote}`
        : flagNote;
      await db
        .update(leases)
        .set({
          notes: updatedNotes,
          gocardlessMandateId: null,
          updatedAt: new Date(),
        })
        .where(eq(leases.id, lease.id));
    }

    // Clear mandate from tenants
    await db
      .update(tenants)
      .set({
        gocardlessMandateId: null,
        updatedAt: new Date(),
      })
      .where(eq(tenants.gocardlessMandateId, mandateId));

    console.log(
      `[GoCardless] Mandate ${mandateId} cancelled: flagged ${affectedLeases.length} lease(s), cleared from DB`
    );

    return c.json({
      data: {
        id: mandate.id,
        status: mandate.status,
      },
      message: "Mandate cancelled. Automatic collection is disabled.",
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to cancel mandate";
    return c.json({ error: message }, 500);
  }
});

// Create a GoCardless customer from tenant details
gocardlessRouter.post(
  "/customers",
  zValidator(
    "json",
    z.object({
      tenantId: z.string().uuid(),
      email: z.string().email(),
      firstName: z.string().min(1),
      lastName: z.string().min(1),
      phone: z.string().optional(),
    })
  ),
  async (c) => {
    if (!isGoCardlessConfigured()) {
      return c.json({ error: "GoCardless is not configured." }, 503);
    }

    const data = c.req.valid("json");

    try {
      const customerId = await createCustomer({
        email: data.email,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone,
        countryCode: "BE",
      });

      // Persist GoCardless customer ID to tenant record
      const db = getDb();
      await db
        .update(tenants)
        .set({
          gocardlessCustomerId: customerId,
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, data.tenantId));

      console.log(
        `[GoCardless] Customer ${customerId} linked to tenant ${data.tenantId}`
      );

      return c.json({
        data: { customerId },
        message: "GoCardless customer created.",
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to create customer";
      return c.json({ error: message }, 500);
    }
  }
);
