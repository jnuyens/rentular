import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { propertiesRouter } from "./routes/properties";
import { tenantsRouter } from "./routes/tenants";
import { leasesRouter } from "./routes/leases";
import { paymentsRouter } from "./routes/payments";
import { indexationRouter } from "./routes/indexation";
import { webhooksRouter } from "./routes/webhooks";
import { settingsRouter } from "./routes/settings";
import { authRouter } from "./routes/auth";
import { costsRouter } from "./routes/costs";
import { rentAdjustmentsRouter } from "./routes/rentAdjustments";
import { bankAccountsRouter } from "./routes/bankAccounts";
import { propertyManagersRouter } from "./routes/propertyManagers";
import { communicationsRouter } from "./routes/communications";
import { gocardlessRouter } from "./routes/gocardless";
import { supportRouter } from "./routes/support";
import { setupPaymentCheckSchedule } from "./jobs/paymentCheckWorker";
import { setupLandlordReportSchedule } from "./jobs/landlordReportWorker";
import { emailQueue } from "./jobs/emailQueueWorker";
import { smsQueue } from "./jobs/smsQueueWorker";

const app = new Hono().basePath("/api/v1");

// Middleware
app.use("*", logger());
app.use("*", prettyJSON());
app.use(
  "*",
  cors({
    origin: process.env.WEB_URL || "http://localhost:3000",
    credentials: true,
  })
);

// Health check
app.get("/health", (c) => c.json({ status: "ok", version: "0.1.0" }));

// Routes
app.route("/properties", propertiesRouter);
app.route("/tenants", tenantsRouter);
app.route("/leases", leasesRouter);
app.route("/payments", paymentsRouter);
app.route("/indexation", indexationRouter);
app.route("/webhooks", webhooksRouter);
app.route("/settings", settingsRouter);
app.route("/auth", authRouter);
app.route("/costs", costsRouter);
app.route("/rent-adjustments", rentAdjustmentsRouter);
app.route("/bank-accounts", bankAccountsRouter);
app.route("/property-managers", propertyManagersRouter);
app.route("/communications", communicationsRouter);
app.route("/gocardless", gocardlessRouter);
app.route("/support", supportRouter);

// Start background job schedules
setupPaymentCheckSchedule().catch((err) =>
  console.error("Failed to setup payment check schedule:", err)
);
setupLandlordReportSchedule().catch((err) =>
  console.error("Failed to setup landlord report schedule:", err)
);

// Email queue is auto-started by importing the worker module
console.log(`[EmailQueue] Worker started (rate limit: ${process.env.EMAIL_RATE_LIMIT || 30}/min)`);
console.log(`[SmsQueue] Worker started (rate limit: ${process.env.SMS_RATE_LIMIT || 10}/min, provider: ${process.env.SMS_PROVIDER || "console"})`);

// 404 handler
app.notFound((c) => c.json({ error: "Not found" }, 404));

// Error handler
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

const port = Number(process.env.API_PORT) || 4000;
console.log(`Rentular API running on http://localhost:${port}`);

serve({ fetch: app.fetch, port });

export default app;
export type AppType = typeof app;
