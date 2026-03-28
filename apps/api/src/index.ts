import { serve } from "@hono/node-server";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { csrf } from "hono/csrf";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import Redis from "ioredis";
import { getDb } from "@rentular/db";
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
import { maintenanceRouter } from "./routes/maintenance";
import { stripeRouter } from "./routes/stripe";
import { importRouter } from "./routes/import";
import { setupPaymentCheckSchedule } from "./jobs/paymentCheckWorker";
import { setupLandlordReportSchedule } from "./jobs/landlordReportWorker";
import { setupWebhookCleanupSchedule } from "./services/webhookCleanup";
import { setupHealthIndexSchedule } from "./jobs/healthIndexWorker";
import { emailQueue } from "./jobs/emailQueueWorker";
import { smsQueue } from "./jobs/smsQueueWorker";
import { importDiscoveryQueue } from "./jobs/importDiscoveryWorker";
import { authMiddleware } from "./lib/authMiddleware";
import { requireAuth } from "./lib/routeAuth";

const app = new Hono().basePath("/api/v1");

// Parse ALLOWED_ORIGINS env var (comma-separated) for both CORS and CSRF
const allowedOrigins = (process.env.ALLOWED_ORIGINS || process.env.WEB_URL || "http://localhost:3000")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const protectedPrefixes = [
  "/properties",
  "/tenants",
  "/leases",
  "/payments",
  "/indexation",
  "/settings",
  "/costs",
  "/rent-adjustments",
  "/bank-accounts",
  "/property-managers",
  "/communications",
  "/gocardless",
  "/maintenance",
  "/import",
];

// Middleware
app.use("*", logger());
app.use("*", prettyJSON());
app.use(
  "*",
  cors({
    origin: (origin) => (allowedOrigins.includes(origin) ? origin : allowedOrigins[0]),
    credentials: true,
  })
);
// CSRF protection for all state-changing requests (per D-01)
// Skip webhook endpoints -- they use signature verification instead
app.use("*", async (c, next) => {
  const path = c.req.path;
  if (path.includes("/webhooks/") || path.includes("/stripe/webhook")) {
    return next();
  }
  return csrf({ origin: (origin) => allowedOrigins.includes(origin) })(c, next);
});
app.use("*", authMiddleware);
for (const prefix of protectedPrefixes) {
  app.use(prefix, requireAuth);
  app.use(`${prefix}/*`, requireAuth);
}
app.use("/support/chat", requireAuth);
app.use("/support/chat/*", requireAuth);
app.use("/stripe/checkout", requireAuth);
app.use("/stripe/subscription", requireAuth);

// Health check -- verifies DB + Redis connectivity (per D-12, not SMTP)
app.get("/health", async (c) => {
  const checks: Record<string, string> = {};

  // Database check
  try {
    const db = getDb();
    await db.execute(sql`SELECT 1`);
    checks.database = "ok";
  } catch {
    checks.database = "error";
  }

  // Redis check
  try {
    const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
      connectTimeout: 3000,
      lazyConnect: true,
    });
    await redis.connect();
    await redis.ping();
    await redis.quit();
    checks.redis = "ok";
  } catch {
    checks.redis = "error";
  }

  const allOk = Object.values(checks).every((v) => v === "ok");
  return c.json(
    { status: allOk ? "healthy" : "degraded", checks, version: "0.1.0" },
    allOk ? 200 : 503
  );
});

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
app.route("/maintenance", maintenanceRouter);
app.route("/stripe", stripeRouter);
app.route("/import", importRouter);

// Start background job schedules
setupPaymentCheckSchedule().catch((err) =>
  console.error("Failed to setup payment check schedule:", err)
);
setupLandlordReportSchedule().catch((err) =>
  console.error("Failed to setup landlord report schedule:", err)
);
setupWebhookCleanupSchedule().catch((err) =>
  console.error("Failed to setup webhook cleanup schedule:", err)
);
setupHealthIndexSchedule().catch((err) =>
  console.error("Failed to setup health index schedule:", err)
);

// Email queue is auto-started by importing the worker module
console.log(`[EmailQueue] Worker started (rate limit: ${process.env.EMAIL_RATE_LIMIT || 30}/min)`);
console.log(`[SmsQueue] Worker started (rate limit: ${process.env.SMS_RATE_LIMIT || 10}/min, provider: ${process.env.SMS_PROVIDER || "console"})`);
console.log("[ImportDiscovery] Worker started");

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
