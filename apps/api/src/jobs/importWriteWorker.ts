import { Worker, Queue } from "bullmq";
import { getDb, importSessions, properties, propertyManagers, tenants, leases, leaseTenants, payments } from "@rentular/db";
import crypto from "crypto";
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
  box: string | null,
) {
  const conditions = [
    eq(properties.ownerId, ownerId),
    eq(properties.street, street),
    eq(properties.streetNumber, streetNumber),
    eq(properties.postalCode, postalCode),
    eq(properties.city, city),
  ];
  // Include box in duplicate check so units at same address are distinct
  if (box) {
    conditions.push(eq(properties.box, box));
  }
  const results = await db
    .select({ id: properties.id })
    .from(properties)
    .where(and(...conditions))
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
    const errors: string[] = []; // Collect per-entity errors

    try {
      // 1. Load session from DB
      console.log(`[ImportWrite] Loading session ${sessionId}...`);
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

      console.log(`[ImportWrite] Session loaded. discoveredData: ${discoveredData.length} properties, selectedIndices: ${JSON.stringify(selectedIndices)}`);

      if (selectedIndices.length === 0) {
        throw new Error("No properties selected for import");
      }

      // 3. Filter to only selected properties
      const selectedProperties = selectedIndices
        .filter((idx) => idx >= 0 && idx < discoveredData.length)
        .map((idx) => discoveredData[idx]);

      if (selectedProperties.length === 0) {
        throw new Error(`Selected indices ${JSON.stringify(selectedIndices)} are out of range for discoveredData (length: ${discoveredData.length})`);
      }

      const total = selectedProperties.length;
      console.log(`[ImportWrite] Starting import of ${total} properties for session ${sessionId}`);

      // 4. Import each selected property (per-property error handling for resilience)
      for (let i = 0; i < selectedProperties.length; i++) {
        const smovinProp = selectedProperties[i];
        const propLabel = `"${smovinProp.name || "unnamed"}" (${smovinProp.address || "no address"})`;

        try {
          // Update progress
          await db
            .update(importSessions)
            .set({
              progress: {
                step: "importing",
                message: `Importing property ${i + 1} of ${total}: ${smovinProp.name || "unnamed"}...`,
                current: i + 1,
                total,
              },
              updatedAt: new Date(),
            })
            .where(eq(importSessions.id, sessionId));

          // 4a. Duplicate check for property (D-06)
          const addr = parseAddress(smovinProp.address || "");
          console.log(`[ImportWrite] Property ${i + 1}/${total} ${propLabel} -> parsed address: street="${addr.street}" number="${addr.streetNumber}" postal="${addr.postalCode}" city="${addr.city}"`);

          const existingProp = await findExistingProperty(
            db,
            session.userId,
            addr.street,
            addr.streetNumber || "0",
            addr.postalCode,
            addr.city,
            addr.box,
          );

          // 4b. Insert property or reuse existing duplicate
          let propertyId: string;
          if (existingProp) {
            console.log(`[ImportWrite] Property exists, reusing for tenant/lease import: ${propLabel} (${existingProp.id})`);
            propertyId = existingProp.id;
            skippedCount++;
          } else {
            const mappedProp = mapSmovinProperty(smovinProp, session.userId);
            console.log(`[ImportWrite] Inserting property: ${mappedProp.name} (id=${mappedProp.id}, type=${mappedProp.type})`);
            await db.insert(properties).values(mappedProp);

            // Auto-register owner in propertyManagers so property is visible in dashboard
            await db.insert(propertyManagers).values({
              id: crypto.randomUUID(),
              propertyId: mappedProp.id,
              userId: session.userId,
              role: "owner",
              invitedBy: null,
              acceptedAt: new Date(),
              invitedAt: new Date(),
            });

            propertyId = mappedProp.id;
            propCount++;
          }

          // 4c. Import tenants for this property
          const tenantIds: string[] = [];
          for (let tIdx = 0; tIdx < (smovinProp.tenants || []).length; tIdx++) {
            const smovinTenant = smovinProp.tenants[tIdx];
            const tenantLabel = `"${smovinTenant.firstName} ${smovinTenant.lastName}"`;
            try {
              // Duplicate check for tenant (D-06)
              const existingTenant = smovinTenant.email
                ? await findExistingTenant(db, session.userId, smovinTenant.email)
                : null;

              if (existingTenant) {
                console.log(`[ImportWrite] Using existing tenant: ${tenantLabel} (${existingTenant.id})`);
                tenantIds.push(existingTenant.id);
              } else {
                const mappedTenant = mapSmovinTenant(smovinTenant, session.userId);
                await db.insert(tenants).values(mappedTenant);
                tenantCount++;
                tenantIds.push(mappedTenant.id);
                console.log(`[ImportWrite] Imported tenant: ${tenantLabel} (${mappedTenant.id})`);
              }
            } catch (tenantErr) {
              const msg = `Tenant ${tenantLabel} for property ${propLabel}: ${tenantErr instanceof Error ? tenantErr.message : String(tenantErr)}`;
              console.error(`[ImportWrite] TENANT ERROR: ${msg}`);
              errors.push(msg);
            }
          }

          // 4d. Import leases for this property (skip if property already has leases)
          const existingLeases = await db.select({ id: leases.id }).from(leases).where(eq(leases.propertyId, propertyId)).limit(1);
          const leaseIds: string[] = existingLeases.map(l => l.id);

          if (existingLeases.length > 0) {
            console.log(`[ImportWrite] Property ${propertyId} already has ${existingLeases.length} lease(s), skipping lease import`);
          }

          for (let lIdx = 0; lIdx < (existingLeases.length === 0 ? (smovinProp.leases || []).length : 0); lIdx++) {
            const smovinLease = smovinProp.leases[lIdx];
            const leaseLabel = `lease ${lIdx + 1} (start: "${smovinLease.startDate}", rent: "${smovinLease.monthlyRent}")`;
            try {
              const mappedLease = mapSmovinLease(
                smovinLease,
                session.userId,
                propertyId,
                addr.postalCode,
              );
              await db.insert(leases).values(mappedLease);
              leaseCount++;
              leaseIds.push(mappedLease.id);
              console.log(`[ImportWrite] Imported ${leaseLabel} -> id=${mappedLease.id}`);

              // Link tenants to this lease
              for (let t = 0; t < tenantIds.length; t++) {
                await db.insert(leaseTenants).values({
                  leaseId: mappedLease.id,
                  tenantId: tenantIds[t],
                  isPrimary: t === 0,
                });
              }
            } catch (leaseErr) {
              const msg = `Lease ${leaseLabel} for property ${propLabel}: ${leaseErr instanceof Error ? leaseErr.message : String(leaseErr)}`;
              console.error(`[ImportWrite] LEASE ERROR: ${msg}`);
              errors.push(msg);
            }
          }

          // 4e. Import payments for this property
          // Use the first lease's ID for linking payments (or skip if no lease)
          const paymentLeaseId = leaseIds[0];
          if (paymentLeaseId) {
            for (let pIdx = 0; pIdx < (smovinProp.payments || []).length; pIdx++) {
              const smovinPayment = smovinProp.payments[pIdx];
              const payLabel = `payment ${pIdx + 1} (date: "${smovinPayment.date}", amount: "${smovinPayment.amount}")`;
              try {
                const mappedPayment = mapSmovinPayment(smovinPayment, paymentLeaseId);
                await db.insert(payments).values(mappedPayment);
                paymentCount++;
              } catch (payErr) {
                const msg = `Payment ${payLabel} for property ${propLabel}: ${payErr instanceof Error ? payErr.message : String(payErr)}`;
                console.error(`[ImportWrite] PAYMENT ERROR: ${msg}`);
                errors.push(msg);
              }
            }
            if ((smovinProp.payments || []).length > 0) {
              console.log(`[ImportWrite] Imported payments for property "${smovinProp.name}": ${smovinProp.payments.length} attempted`);
            }
          } else if ((smovinProp.payments || []).length > 0) {
            console.log(`[ImportWrite] Skipping ${smovinProp.payments.length} payments for property "${smovinProp.name}" (no lease to link to)`);
          }
        } catch (propErr) {
          const msg = `Property ${propLabel}: ${propErr instanceof Error ? propErr.message : String(propErr)}`;
          console.error(`[ImportWrite] PROPERTY ERROR: ${msg}`);
          errors.push(msg);
          skippedCount++;
        }
      }

      // 5. On success (or partial success) -- credential cleanup per D-04
      const hasErrors = errors.length > 0;
      const importedAnything = propCount > 0 || tenantCount > 0 || leaseCount > 0 || paymentCount > 0;

      // If nothing was imported and there were errors, mark as failed
      if (!importedAnything && hasErrors) {
        const errorSummary = `Import failed for all ${total} properties. Errors:\n${errors.join("\n")}`;
        console.error(`[ImportWrite] ${errorSummary}`);
        await db
          .update(importSessions)
          .set({
            status: "failed",
            errorMessage: errorSummary,
            progress: {
              step: "failed",
              message: `Import failed. ${errors.length} error(s).`,
              current: 0,
              total,
            },
            updatedAt: new Date(),
          })
          .where(eq(importSessions.id, sessionId));
        return;
      }

      // Build a result message including any partial errors
      let resultMessage = "Import complete";
      if (hasErrors) {
        resultMessage = `Import completed with ${errors.length} error(s). Some records were skipped.`;
      }

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
          errorMessage: hasErrors ? `Partial import. ${errors.length} error(s):\n${errors.join("\n")}` : null,
          // Keep credentials so user can retry without re-entering (user deletes explicitly via UI)
          progress: {
            step: "complete",
            message: resultMessage,
            current: total,
            total,
          },
          updatedAt: new Date(),
        })
        .where(eq(importSessions.id, sessionId));

      console.log(
        `[ImportWrite] Import complete: ${propCount} properties, ${tenantCount} tenants, ${leaseCount} leases, ${paymentCount} payments imported (${skippedCount} skipped, ${errors.length} errors)`,
      );
      if (hasErrors) {
        console.warn(`[ImportWrite] Partial errors:\n${errors.join("\n")}`);
      }
    } catch (err) {
      // 6. On failure -- do NOT delete credentials per D-05 (user can retry)
      const errorMsg = err instanceof Error ? err.message : String(err);
      const fullStack = err instanceof Error && err.stack ? err.stack : "";
      console.error(`[ImportWrite] FATAL for session ${sessionId}: ${errorMsg}`);
      if (fullStack) {
        console.error(`[ImportWrite] Stack trace: ${fullStack}`);
      }

      // Include partial import counts and per-entity errors in the error message
      const errorParts = [errorMsg];
      if (errors.length > 0) {
        errorParts.push(`Additionally, ${errors.length} per-entity error(s):\n${errors.join("\n")}`);
      }
      if (propCount > 0 || tenantCount > 0) {
        errorParts.push(`Before failure: ${propCount} properties, ${tenantCount} tenants, ${leaseCount} leases, ${paymentCount} payments were imported.`);
      }

      await db
        .update(importSessions)
        .set({
          status: "failed",
          errorMessage: errorParts.join("\n\n"),
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
