import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import crypto from "crypto";
import { getDb, importSessions } from "@rentular/db";
import { eq, and, desc } from "drizzle-orm";
import { getRequiredUserId } from "../lib/routeAuth";
import { encrypt } from "../lib/encryption";
import { importDiscoveryQueue } from "../jobs/importDiscoveryWorker";

export const importRouter = new Hono();

// Fields to select for status/latest responses (never include credential columns)
const sessionPublicFields = {
  id: importSessions.id,
  userId: importSessions.userId,
  status: importSessions.status,
  progress: importSessions.progress,
  discoveredData: importSessions.discoveredData,
  selectedProperties: importSessions.selectedProperties,
  importedCounts: importSessions.importedCounts,
  errorMessage: importSessions.errorMessage,
  discoveryJobId: importSessions.discoveryJobId,
  importJobId: importSessions.importJobId,
  createdAt: importSessions.createdAt,
  updatedAt: importSessions.updatedAt,
};

// POST / - Submit Smovin credentials and create import session
importRouter.post(
  "/",
  zValidator(
    "json",
    z.object({
      email: z.string().email(),
      password: z.string().min(1),
    }),
  ),
  async (c) => {
    try {
      const userId = getRequiredUserId(c);
      const { email, password } = c.req.valid("json");

      const encEmail = encrypt(email);
      const encPassword = encrypt(password);

      const id = crypto.randomUUID();
      const db = getDb();

      await db.insert(importSessions).values({
        id,
        userId,
        status: "pending",
        credentialEmail: encEmail.encrypted,
        credentialEmailIv: encEmail.iv,
        credentialEmailTag: encEmail.tag,
        credentialPassword: encPassword.encrypted,
        credentialPasswordIv: encPassword.iv,
        credentialPasswordTag: encPassword.tag,
      });

      console.log(`[Import] Created import session ${id} for user ${userId}`);
      return c.json({ data: { sessionId: id, status: "pending" } }, 201);
    } catch (err) {
      console.error("[Import] Failed to create import session:", err);
      return c.json({ error: "Failed to create import session" }, 500);
    }
  },
);

// GET /status/:sessionId - Poll import status and progress
importRouter.get("/status/:sessionId", async (c) => {
  try {
    const userId = getRequiredUserId(c);
    const sessionId = c.req.param("sessionId");
    const db = getDb();

    const [session] = await db
      .select(sessionPublicFields)
      .from(importSessions)
      .where(and(eq(importSessions.id, sessionId), eq(importSessions.userId, userId)))
      .limit(1);

    if (!session) {
      return c.json({ error: "Import session not found" }, 404);
    }

    return c.json({ data: session });
  } catch (err) {
    console.error("[Import] Failed to fetch import status:", err);
    return c.json({ error: "Failed to fetch import status" }, 500);
  }
});

// POST /start-discovery/:sessionId - Kick off BullMQ discovery job
importRouter.post("/start-discovery/:sessionId", async (c) => {
  try {
    const userId = getRequiredUserId(c);
    const sessionId = c.req.param("sessionId");
    const db = getDb();

    const [session] = await db
      .select()
      .from(importSessions)
      .where(and(eq(importSessions.id, sessionId), eq(importSessions.userId, userId)))
      .limit(1);

    if (!session) {
      return c.json({ error: "Import session not found" }, 404);
    }

    // Allow starting discovery from pending, failed, or completed (retry/re-import case)
    if (session.status !== "pending" && session.status !== "failed" && session.status !== "completed") {
      return c.json(
        { error: `Cannot start discovery from status "${session.status}". Must be "pending", "failed", or "completed".` },
        400,
      );
    }

    // Use timestamp suffix to avoid BullMQ deduplication on retry
    const jobId = `discovery-${sessionId}-${Date.now()}`;

    // Update session status to discovering
    await db
      .update(importSessions)
      .set({
        status: "discovering",
        errorMessage: null,
        discoveryJobId: jobId,
        updatedAt: new Date(),
      })
      .where(eq(importSessions.id, sessionId));

    // Queue the discovery job
    await importDiscoveryQueue.add("discover", { sessionId }, { jobId });

    console.log(`[Import] Started discovery job ${jobId} for session ${sessionId}`);
    return c.json({ data: { sessionId, status: "discovering", jobId } });
  } catch (err) {
    console.error("[Import] Failed to start discovery:", err);
    return c.json({ error: "Failed to start discovery" }, 500);
  }
});

// POST /start-import/:sessionId - Kick off import of selected properties
importRouter.post(
  "/start-import/:sessionId",
  zValidator(
    "json",
    z.object({
      selectedProperties: z.array(z.number()),
    }),
  ),
  async (c) => {
    try {
      const userId = getRequiredUserId(c);
      const sessionId = c.req.param("sessionId");
      const { selectedProperties } = c.req.valid("json");
      const db = getDb();

      console.log(`[Import] start-import request: session=${sessionId}, user=${userId}, selectedProperties=${JSON.stringify(selectedProperties)}`);

      const [session] = await db
        .select()
        .from(importSessions)
        .where(and(eq(importSessions.id, sessionId), eq(importSessions.userId, userId)))
        .limit(1);

      if (!session) {
        console.warn(`[Import] Session not found: ${sessionId} for user ${userId}`);
        return c.json({ error: "Import session not found" }, 404);
      }

      if (session.status !== "discovered") {
        console.warn(`[Import] Cannot start import: session ${sessionId} status is "${session.status}", expected "discovered"`);
        return c.json(
          { error: `Cannot start import from status "${session.status}". Must be "discovered".` },
          400,
        );
      }

      // Validate discoveredData exists
      const rawDiscovered = session.discoveredData;
      const discoveredCount = Array.isArray(rawDiscovered) ? rawDiscovered.length :
        typeof rawDiscovered === "string" ? JSON.parse(rawDiscovered).length : 0;
      console.log(`[Import] Session ${sessionId} has ${discoveredCount} discovered properties, user selected ${selectedProperties.length} indices`);

      // Use timestamp suffix to avoid BullMQ deduplication on retry
      const jobId = `import-${sessionId}-${Date.now()}`;

      // Update session status to importing
      await db
        .update(importSessions)
        .set({
          status: "importing",
          selectedProperties,
          errorMessage: null, // Clear any previous error
          importJobId: jobId,
          updatedAt: new Date(),
        })
        .where(eq(importSessions.id, sessionId));

      // Dynamic import to avoid compile-time dependency on Plan 03's importWriteWorker
      const { importWriteQueue } = await import("../jobs/importWriteWorker");
      await importWriteQueue.add("import", { sessionId }, { jobId });

      console.log(`[Import] Started import job ${jobId} for session ${sessionId}`);
      return c.json({ data: { sessionId, status: "importing", jobId } });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : "";
      console.error(`[Import] Failed to start import: ${errorMsg}`);
      if (stack) console.error(`[Import] Stack: ${stack}`);
      return c.json({ error: `Failed to start import: ${errorMsg}` }, 500);
    }
  },
);

// DELETE /credentials/:sessionId - Delete stored credentials (D-05)
importRouter.delete("/credentials/:sessionId", async (c) => {
  try {
    const userId = getRequiredUserId(c);
    const sessionId = c.req.param("sessionId");
    const db = getDb();

    const [session] = await db
      .select({ id: importSessions.id, userId: importSessions.userId })
      .from(importSessions)
      .where(and(eq(importSessions.id, sessionId), eq(importSessions.userId, userId)))
      .limit(1);

    if (!session) {
      return c.json({ error: "Import session not found" }, 404);
    }

    // Clear all 6 credential columns
    await db
      .update(importSessions)
      .set({
        credentialEmail: null,
        credentialEmailIv: null,
        credentialEmailTag: null,
        credentialPassword: null,
        credentialPasswordIv: null,
        credentialPasswordTag: null,
        updatedAt: new Date(),
      })
      .where(eq(importSessions.id, sessionId));

    console.log(`[Import] Deleted credentials for session ${sessionId}`);
    return c.json({ data: { sessionId, credentialsDeleted: true } });
  } catch (err) {
    console.error("[Import] Failed to delete credentials:", err);
    return c.json({ error: "Failed to delete credentials" }, 500);
  }
});

// GET /latest - Get user's most recent import session
importRouter.get("/latest", async (c) => {
  try {
    const userId = getRequiredUserId(c);
    const db = getDb();

    const [session] = await db
      .select(sessionPublicFields)
      .from(importSessions)
      .where(eq(importSessions.userId, userId))
      .orderBy(desc(importSessions.createdAt))
      .limit(1);

    return c.json({ data: session || null });
  } catch (err) {
    console.error("[Import] Failed to fetch latest import session:", err);
    return c.json({ error: "Failed to fetch latest import session" }, 500);
  }
});
