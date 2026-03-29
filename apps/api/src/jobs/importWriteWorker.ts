import { Worker, Queue } from "bullmq";
import { getDb, importSessions, properties, tenants, leases, leaseTenants, payments } from "@rentular/db";
import { eq, and } from "drizzle-orm";
import {
  mapSmovinProperty,
  mapSmovinTenant,
  mapSmovinLease,
  mapSmovinPayment,
  parseAddress,
  type SmovinProperty,
} from "../services/smovinMapper";

const QUEUE_NAME = "import-write";

const connection = {
  host: process.env.REDIS_HOST || "localhost",
  port: Number(process.env.REDIS_PORT) || 6379,
  maxRetriesPerRequest: null,
};

export const importWriteQueue = new Queue(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 10000 },
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 50 },
    timeout: 600000, // 10 minutes (writing is faster than scraping)
  },
});

/**
 * Find an existing property by address match (D-06 duplicate detection).
 * Matches on street + streetNumber + postalCode + city for the same owner.
 */
async function findExistingProperty(
  db: ReturnType<typeof getDb>,
  ownerId: string,
  street: string,
  streetNumber: string,
  postalCode: string,
  city: string,
) {
  const results = await db
    .select({ id: properties.id })
    .from(properties)
    .where(
      and(
        eq(properties.ownerId, ownerId),
        eq(properties.street, street),
        eq(properties.streetNumber, streetNumber),
        eq(properties.postalCode, postalCode),
        eq(properties.city, city),
      ),
    )
    .limit(1);
  return results[0] || null;
}

/**
 * Find an existing tenant by email match (D-06 duplicate detection).
 * Only checks if tenant has an email address.
 */
async function findExistingTenant(
  db: ReturnType<typeof getDb>,
  ownerId: string,
  email: string,
) {
  if (!email) return null;
  const results = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.ownerId, ownerId), eq(tenants.email, email)))
    .limit(1);
  return results[0] || null;
}

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { sessionId } = job.data as { sessionId: string };
    const db = getDb();

    // Counters for import results
    let propCount = 0;
    let tenantCount = 0;
    let leaseCount = 0;
    let paymentCount = 0;
    let skippedCount = 0;

    try {
      // 1. Load session from DB
      const [session] = await db
        .select()
        .from(importSessions)
        .where(eq(importSessions.id, sessionId))
        .limit(1);

      if (!session) throw new Error("Import session not found");

      // 2. Parse discoveredData and selectedProperties (MySQL JSON columns may return strings)
      const rawDiscovered = session.discoveredData;
      const discoveredData = (typeof rawDiscovered === "string" ? JSON.parse(rawDiscovered) : rawDiscovered || []) as SmovinProperty[];
      const rawSelected = session.selectedProperties;
      const selectedIndices = (typeof rawSelected === "string" ? JSON.parse(rawSelected) : rawSelected || []) as number[];

      if (selectedIndices.length === 0) {
        throw new Error("No properties selected for import");
      }

      // 3. Filter to only selected properties
      const selectedProperties = selectedIndices
        .filter((idx) => idx >= 0 && idx < discoveredData.length)
        .map((idx) => discoveredData[idx]);

      const total = selectedProperties.length;
      console.log(`[ImportWrite] Starting import of ${total} properties for session ${sessionId}`);

      // 4. Import each selected property
      for (let i = 0; i < selectedProperties.length; i++) {
        const smovinProp = selectedProperties[i];

        // Update progress
        await db
          .update(importSessions)
          .set({
            progress: {
              step: "importing",
              message: `Importing property ${i + 1} of ${total}...`,
              current: i + 1,
              total,
            },
            updatedAt: new Date(),
          })
          .where(eq(importSessions.id, sessionId));

        // 4a. Duplicate check for property (D-06)
        const addr = parseAddress(smovinProp.address);
        const existingProp = await findExistingProperty(
          db,
          session.userId,
          addr.street,
          addr.streetNumber || "0",
          addr.postalCode,
          addr.city,
        );

        if (existingProp) {
          console.log(
            `[ImportWrite] Skipping duplicate property: ${smovinProp.name} (${smovinProp.address})`,
          );
          skippedCount++;
          continue;
        }

        // 4b. Insert property
        const mappedProp = mapSmovinProperty(smovinProp, session.userId);
        await db.insert(properties).values(mappedProp);
        propCount++;
        console.log(`[ImportWrite] Imported property: ${mappedProp.name} (${mappedProp.id})`);

        // 4c. Import tenants for this property
        const tenantIds: string[] = [];
        for (const smovinTenant of smovinProp.tenants || []) {
          // Duplicate check for tenant (D-06)
          const existingTenant = smovinTenant.email
            ? await findExistingTenant(db, session.userId, smovinTenant.email)
            : null;

          if (existingTenant) {
            console.log(
              `[ImportWrite] Using existing tenant: ${smovinTenant.firstName} ${smovinTenant.lastName} (${existingTenant.id})`,
            );
            tenantIds.push(existingTenant.id);
          } else {
            const mappedTenant = mapSmovinTenant(smovinTenant, session.userId);
            await db.insert(tenants).values(mappedTenant);
            tenantCount++;
            tenantIds.push(mappedTenant.id);
            console.log(
              `[ImportWrite] Imported tenant: ${mappedTenant.firstName} ${mappedTenant.lastName} (${mappedTenant.id})`,
            );
          }
        }

        // 4d. Import leases for this property
        const leaseIds: string[] = [];
        for (const smovinLease of smovinProp.leases || []) {
          const mappedLease = mapSmovinLease(
            smovinLease,
            session.userId,
            mappedProp.id,
            mappedProp.postalCode,
          );
          await db.insert(leases).values(mappedLease);
          leaseCount++;
          leaseIds.push(mappedLease.id);
          console.log(`[ImportWrite] Imported lease: ${mappedLease.id} (${mappedLease.startDate} - ${mappedLease.endDate || "ongoing"})`);

          // Link tenants to this lease
          for (let t = 0; t < tenantIds.length; t++) {
            await db.insert(leaseTenants).values({
              leaseId: mappedLease.id,
              tenantId: tenantIds[t],
              isPrimary: t === 0,
            });
          }
        }

        // 4e. Import payments for this property
        // Use the first lease's ID for linking payments (or skip if no lease)
        const paymentLeaseId = leaseIds[0];
        if (paymentLeaseId) {
          for (const smovinPayment of smovinProp.payments || []) {
            const mappedPayment = mapSmovinPayment(smovinPayment, paymentLeaseId);
            await db.insert(payments).values(mappedPayment);
            paymentCount++;
          }
          if ((smovinProp.payments || []).length > 0) {
            console.log(
              `[ImportWrite] Imported ${smovinProp.payments.length} payments for property ${mappedProp.name}`,
            );
          }
        } else if ((smovinProp.payments || []).length > 0) {
          console.log(
            `[ImportWrite] Skipping ${smovinProp.payments.length} payments for property ${mappedProp.name} (no lease to link to)`,
          );
        }
      }

      // 5. On success -- credential cleanup per D-04
      await db
        .update(importSessions)
        .set({
          status: "completed",
          importedCounts: {
            properties: propCount,
            tenants: tenantCount,
            leases: leaseCount,
            payments: paymentCount,
            skipped: skippedCount,
          },
          credentialEmail: null,
          credentialEmailIv: null,
          credentialEmailTag: null,
          credentialPassword: null,
          credentialPasswordIv: null,
          credentialPasswordTag: null,
          progress: {
            step: "complete",
            message: "Import complete",
            current: total,
            total,
          },
          updatedAt: new Date(),
        })
        .where(eq(importSessions.id, sessionId));

      console.log(
        `[ImportWrite] Import complete: ${propCount} properties, ${tenantCount} tenants, ${leaseCount} leases, ${paymentCount} payments imported (${skippedCount} skipped)`,
      );
    } catch (err) {
      // 6. On failure -- do NOT delete credentials per D-05 (user can retry)
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[ImportWrite] Failed for session ${sessionId}:`, errorMsg);

      await db
        .update(importSessions)
        .set({
          status: "failed",
          errorMessage: errorMsg,
          updatedAt: new Date(),
        })
        .where(eq(importSessions.id, sessionId));
    }
  },
  {
    connection,
    concurrency: 1, // One import at a time
  },
);

worker.on("failed", (job, err) => {
  console.error(`[ImportWrite] Job ${job?.id} failed:`, err.message);
});

worker.on("completed", (job) => {
  console.log(`[ImportWrite] Job ${job.id} completed`);
});

export { worker as importWriteWorker };
