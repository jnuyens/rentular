import { Worker, Queue } from "bullmq";
import { getDb, importSessions } from "@rentular/db";
import { eq } from "drizzle-orm";
import { decrypt } from "../lib/encryption";
import { createStealthBrowser, loginToSmovin, randomDelay } from "../services/smovinScraper";

const QUEUE_NAME = "import-discovery";

const connection = {
  host: process.env.REDIS_HOST || "localhost",
  port: Number(process.env.REDIS_PORT) || 6379,
  maxRetriesPerRequest: null,
};

export const importDiscoveryQueue = new Queue(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 10000 },
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 50 },
    // Note: per-job `timeout` was removed in BullMQ v5 (it was never a valid
    // JobsOptions field here). Stalled-job handling is governed by the worker's
    // lockDuration/stalledInterval instead.
  },
});

// Discovered data types
interface SmovinDiscoveredProperty {
  name: string;
  address: string;
  type: string;
  tenants: Array<{ firstName: string; lastName: string; email?: string; phone?: string; language?: string }>;
  leases: Array<{ startDate: string; endDate?: string; monthlyRent: string; charges?: string; type?: string }>;
  payments: Array<{ date: string; amount: string; status: string; description?: string }>;
}

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { sessionId } = job.data as { sessionId: string };
    const db = getDb();
    let browser: Awaited<ReturnType<typeof createStealthBrowser>>["browser"] | null = null;

    // Progress helper
    async function updateProgress(step: string, message: string, current = 0, total = 0) {
      const progressData = { step, message, current, total };
      await db
        .update(importSessions)
        .set({ progress: progressData, updatedAt: new Date() })
        .where(eq(importSessions.id, sessionId));
      console.log(`[ImportDiscovery] ${message}`);
    }

    try {
      // 1. Load session and decrypt credentials
      const [session] = await db
        .select()
        .from(importSessions)
        .where(eq(importSessions.id, sessionId))
        .limit(1);

      if (!session) throw new Error("Import session not found");

      if (!session.credentialEmail || !session.credentialEmailIv || !session.credentialEmailTag ||
          !session.credentialPassword || !session.credentialPasswordIv || !session.credentialPasswordTag) {
        throw new Error("Credentials missing or incomplete");
      }

      const email = decrypt(session.credentialEmail, session.credentialEmailIv, session.credentialEmailTag);
      const password = decrypt(session.credentialPassword, session.credentialPasswordIv, session.credentialPasswordTag);

      await updateProgress("init", "Initializing stealth browser...");

      // 2. Launch stealth browser
      const browserResult = await createStealthBrowser();
      browser = browserResult.browser;
      const context = browserResult.context;
      const page = await context.newPage();

      await updateProgress("login", "Logging into Smovin...");

      // 3. Login to Smovin
      const loginResult = await loginToSmovin(page, email, password);
      if (!loginResult.success) {
        const errorMsg = loginResult.error === "cloudflare_blocked"
          ? "Cloudflare anti-bot protection blocked the login. Please try again later."
          : loginResult.error === "login_failed"
            ? "Invalid Smovin credentials. Please check your email and password."
            : loginResult.error === "login_form_not_found"
              ? "Could not find the Smovin login form. The site may have changed."
              : `Login failed: ${loginResult.error}`;

        await db
          .update(importSessions)
          .set({ status: "failed", errorMessage: errorMsg, updatedAt: new Date() })
          .where(eq(importSessions.id, sessionId));
        return;
      }

      await updateProgress("navigating", "Navigating to properties page...");

      // 4. Navigate to properties/patrimony page
      // Per Plan 01 insights: Smovin uses web.smovin.app, properties at /patrimony
      // Detect Smovin UI locale from redirect (e.g., /nl/, /fr/, /en/)
      let smovinLocale = "nl"; // Default
      await page.goto("https://web.smovin.app/patrimony", {
        waitUntil: "load",
        timeout: 60000,
      });
      await page.waitForLoadState("networkidle").catch(() => {
        console.log("[ImportDiscovery] networkidle timeout on patrimony page, continuing...");
      });
      await randomDelay(2000, 4000);

      // Detect locale from URL (Smovin redirects /patrimony to /{locale}/patrimony/...)
      const currentUrl = page.url();
      const localeMatch = currentUrl.match(/web\.smovin\.app\/(nl|fr|en|de)\//);
      if (localeMatch) {
        smovinLocale = localeMatch[1];
        console.log(`[ImportDiscovery] Detected Smovin locale: ${smovinLocale}`);
      }

      await updateProgress("properties", "Discovering properties...");

      // 5. Scrape property list
      const discoveredProperties: SmovinDiscoveredProperty[] = [];

      // Smovin redirects /patrimony to /nl/patrimony/contracts/ which lists contracts with UUIDs
      try {
        // Wait for contract links to render
        await page.waitForSelector("a[href*='/patrimony/contracts/']", {
          timeout: 15000,
        }).catch(() => {
          console.log("[ImportDiscovery] No contract links found, trying units page...");
        });

        // Find contract detail links (UUID pattern)
        let propertyLinks: string[] = [];

        const contractLinks = await page.$$eval(
          "a[href*='/patrimony/contracts/']",
          (links: HTMLAnchorElement[]) =>
            links
              .map((a) => a.href)
              .filter((href) => /\/patrimony\/contracts\/[0-9a-f-]{36}\//.test(href)),
        ).catch(() => [] as string[]);

        if (contractLinks.length > 0) {
          propertyLinks = [...new Set(contractLinks)];
        }

        // Fallback: try units page
        if (propertyLinks.length === 0) {
          console.log("[ImportDiscovery] No contracts found, trying units page...");
          await page.goto("https://web.smovin.app/nl/patrimony/units/", { waitUntil: "load", timeout: 30000 });
          await page.waitForLoadState("networkidle").catch(() => {});
          await randomDelay(2000, 4000);

          const unitLinks = await page.$$eval(
            "a[href*='/patrimony/units/']",
            (links: HTMLAnchorElement[]) =>
              links
                .map((a) => a.href)
                .filter((href) => /\/patrimony\/units\/[0-9a-f-]{36}\//.test(href)),
          ).catch(() => [] as string[]);

          if (unitLinks.length > 0) {
            propertyLinks = [...new Set(unitLinks)];
          }
        }

        const totalProperties = propertyLinks.length;
        console.log(`[ImportDiscovery] Found ${totalProperties} property links`);

        if (totalProperties === 0) {
          // If no property links found, try to extract from the page content directly
          const pageText = await page.textContent("body").catch(() => "");
          console.log(`[ImportDiscovery] No property links found. Page text (first 2000 chars): ${pageText?.substring(0, 2000)}`);

          // Store empty discovered data with a note
          await db
            .update(importSessions)
            .set({
              status: "discovered",
              discoveredData: [],
              progress: { step: "complete", message: "No properties found on Smovin account", current: 0, total: 0 },
              updatedAt: new Date(),
            })
            .where(eq(importSessions.id, sessionId));
          return;
        }

        // 6. Scrape each property detail page
        for (let i = 0; i < propertyLinks.length; i++) {
          const propertyUrl = propertyLinks[i];
          await updateProgress(
            "properties",
            `Discovering property ${i + 1} of ${totalProperties}...`,
            i + 1,
            totalProperties,
          );

          const property: SmovinDiscoveredProperty = {
            name: "",
            address: "",
            type: "",
            tenants: [],
            leases: [],
            payments: [],
          };

          try {
            // Navigate to contract/property detail page
            await page.goto(propertyUrl, { waitUntil: "load", timeout: 30000 });
            await page.waitForLoadState("networkidle").catch(() => {});
            await randomDelay(1500, 3000);

            // Extract all text from the page for parsing
            const bodyText = await page.textContent("body").catch(() => "") || "";

            // Extract property/contract name from the page heading
            // Smovin shows the contract name prominently (e.g. "Arendonck 001")
            property.name = await page
              .textContent("h1, h2")
              .then((t) => {
                // Clean up — remove nav items, keep first meaningful heading
                const cleaned = t?.split("\n").map((l) => l.trim()).filter(Boolean);
                return cleaned?.find((l) => l.length > 2 && l.length < 100 && !["Dashboard", "Contracten", "Eigendommen", "Taken"].includes(l)) || `Property ${i + 1}`;
              })
              .catch(() => `Property ${i + 1}`);

            // Extract address from the page — look for street pattern near the property name
            const addressMatch = bodyText.match(/(?:Gebouw|Bâtiment|Building)\s*\n?\s*([^\n]+(?:straat|laan|weg|steenweg|plein|dreef|lei|singel|boulevard|avenue|rue|Str)[^\n]*)/i)
              || bodyText.match(/([A-Z][a-z]+(?:straat|laan|weg|steenweg|plein|dreef|lei)[^\n]*\d+[^\n]*)/);
            property.address = addressMatch ? addressMatch[1].trim() : "";

            // Extract type from contract info
            const typeMatch = bodyText.match(/(?:Hoofdverblijfplaats|Résidence principale|Primary residence)/i);
            property.type = typeMatch ? "residential" : "unknown";

            // 7. Extract tenants from the contract detail page
            // Smovin shows "Huurder(s)" section with names, emails, phones
            try {
              const tenantSection = bodyText.split(/Huurder\(s\)|Locataire\(s\)|Tenant\(s\)/i)[1] || "";
              // Find names with email patterns
              const nameEmailMatches = tenantSection.match(/([A-Z][.\s][\w\s]+)\s*<([^>]+)>/g) || [];
              for (const match of nameEmailMatches) {
                const parts = match.match(/([A-Z][.\s][\w\s]+)\s*<([^>]+)>/);
                if (parts) {
                  const fullName = parts[1].trim();
                  const email = parts[2].trim();
                  const nameParts = fullName.split(/\s+/);
                  // Find phone number near this tenant
                  const phoneMatch = tenantSection.match(/(\+\d[\d\s]{8,})/);
                  property.tenants.push({
                    firstName: nameParts[0] || "",
                    lastName: nameParts.slice(1).join(" ") || "",
                    email,
                    phone: phoneMatch ? phoneMatch[1].trim() : undefined,
                    language: smovinLocale,
                  });
                }
              }
              // If no email-style matches, try just names
              if (property.tenants.length === 0) {
                const nameMatches = tenantSection.match(/([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g) || [];
                for (const name of nameMatches.slice(0, 3)) { // Max 3 tenants
                  const nameParts = name.trim().split(/\s+/);
                  property.tenants.push({
                    firstName: nameParts[0] || "",
                    lastName: nameParts.slice(1).join(" ") || "",
                    language: smovinLocale,
                  });
                }
              }
            } catch (tenantErr) {
              console.log(`[ImportDiscovery] Could not scrape tenants for property ${i + 1}:`, tenantErr);
            }

            // 8. Extract lease/contract info from the same page
            try {
              // Dates: try multiple patterns (label + date, or standalone dates near keywords)
              const startMatch = bodyText.match(/(?:Begindatum|Date de début|Start date|Startdatum|Aanvang|Début)\s*:?\s*\n?\s*(\d{1,2}[\/.]\d{1,2}[\/.]\d{4})/i)
                || bodyText.match(/(\d{1,2}[\/.]\d{1,2}[\/.]\d{4})\s*(?:tot|à|until|-)\s*\d/i);
              const endMatch = bodyText.match(/(?:einddatum|eindigen|Einde|Date de fin|End date|Einddatum|Fin)\s*:?\s*\n?\s*(\d{1,2}[\/.]\d{1,2}[\/.]\d{4})/i)
                || bodyText.match(/(?:tot|à|until|-)\s*(\d{1,2}[\/.]\d{1,2}[\/.]\d{4})/i);

              // Rent: try multiple patterns (label + amount, or any euro-prefixed/suffixed amount)
              // Allow generous whitespace between label and value (Smovin often has newlines between them)
              // IMPORTANT: Do NOT match "Huidige index" — that's the health index number, not the rent!
              const currentRentMatch = bodyText.match(/(?:Huidige huur|Huurprijs|Loyer actuel|Current rent|Maandelijkse huur)\s*:?\s*[\n\r\s]*([\d\s.,]+)\s*€/i)
                || bodyText.match(/(?:Loyer|Huur)\s*(?:mensuel|maandelijks)?\s*:?\s*[\n\r\s]*([\d\s.,]+)\s*€/i)
                || bodyText.match(/€\s*([\d\s.,]+(?:,\d{2}))/);
              const initialRentMatch = bodyText.match(/(?:Initiële huur|Loyer initial|Initial rent|Basishuur|Basishuurprijs)\s*:?\s*[\n\r\s]*([\d\s.,]+)\s*€/i);

              // Fallback: find all non-zero "X,XX €" amounts on the page and pick the largest
              // (monthly rent is typically the largest euro amount on a contract page)
              let anyRentMatch: RegExpMatchArray | null = null;
              if (!currentRentMatch && !initialRentMatch) {
                const allAmounts = [...bodyText.matchAll(/([1-9][\d.]*,\d{2})\s*€/g)];
                if (allAmounts.length > 0) {
                  const parseEuro = (s: string) => parseFloat(s.replace(/\./g, "").replace(",", "."));
                  allAmounts.sort((a, b) => parseEuro(b[1]) - parseEuro(a[1]));
                  anyRentMatch = allAmounts[0]; // largest amount
                  console.log(`[ImportDiscovery] Fallback rent for "${property.name}": picked ${anyRentMatch[1]} € (largest of ${allAmounts.length} amounts: ${allAmounts.map(m => m[1]).join(", ")})`);
                }
              }

              // Prefer non-zero rent sources: if currentRentMatch captured "0,00", try alternatives
              const isZeroRent = (match: RegExpMatchArray | null) =>
                match && /^[0\s.,]+$/.test(match[1].replace(/\s/g, ""));
              const rentSource = (currentRentMatch && !isZeroRent(currentRentMatch) ? currentRentMatch : null)
                || (initialRentMatch && !isZeroRent(initialRentMatch) ? initialRentMatch : null)
                || anyRentMatch
                || currentRentMatch
                || initialRentMatch;

              // Extract charges/costs (Kosten, Provisie, Charges, Lasten)
              const chargesMatch = bodyText.match(/(?:Kosten|Provisie|Charges|Lasten|Forfait|Maandelijkse kosten)\s*:?\s*[\n\r\s]*([\d\s.,]+)\s*€/i);

              // Log what was found for debugging
              console.log(`[ImportDiscovery] Lease data for "${property.name}": start=${startMatch?.[1] || "none"}, end=${endMatch?.[1] || "none"}, rent=${rentSource?.[1] || "none"}, charges=${chargesMatch?.[1] || "none"}`);

              // Create lease if we found any rent amount OR any date
              if (startMatch || rentSource) {
                property.leases.push({
                  startDate: startMatch ? startMatch[1] : "",
                  endDate: endMatch ? endMatch[1] : undefined,
                  monthlyRent: rentSource ? rentSource[1].replace(/\s/g, "").trim() + " €" : "",
                  charges: chargesMatch ? chargesMatch[1].replace(/\s/g, "").trim() + " €" : undefined,
                  type: typeMatch ? "residential" : undefined,
                });
              } else {
                // Log a snippet of the page content to help debug what Smovin shows
                const snippet = bodyText.replace(/\s+/g, " ").substring(0, 1500);
                console.log(`[ImportDiscovery] No lease data for "${property.name}". Page snippet: ${snippet}`);
              }
            } catch (leaseErr) {
              console.log(`[ImportDiscovery] Could not scrape leases for property ${i + 1}:`, leaseErr);
            }

            // 9. Skip per-contract payment scraping to keep discovery fast
            // Payments will be scraped during import phase if needed

            // Navigate back to contracts list for next iteration
            await page.goto("https://web.smovin.app/nl/patrimony/contracts/", {
              waitUntil: "load",
              timeout: 30000,
            });
            await page.waitForLoadState("networkidle").catch(() => {});
            await randomDelay(1000, 2000);
          } catch (propErr) {
            console.error(`[ImportDiscovery] Error scraping property ${i + 1}:`, propErr);
            property.name = property.name || `Property ${i + 1} (error during scraping)`;
          }

          discoveredProperties.push(property);
        }
      } catch (scrapeErr) {
        console.error("[ImportDiscovery] Error during property scraping:", scrapeErr);
        // Store whatever we found so far
        if (discoveredProperties.length > 0) {
          await db
            .update(importSessions)
            .set({
              status: "discovered",
              discoveredData: discoveredProperties,
              progress: {
                step: "complete",
                message: `Discovery completed with errors. Found ${discoveredProperties.length} properties.`,
                current: discoveredProperties.length,
                total: discoveredProperties.length,
              },
              updatedAt: new Date(),
            })
            .where(eq(importSessions.id, sessionId));
          return;
        }
        throw scrapeErr;
      }

      // 10. Store discovered data and mark as discovered
      await db
        .update(importSessions)
        .set({
          status: "discovered",
          discoveredData: discoveredProperties,
          progress: {
            step: "complete",
            message: `Discovery complete. Found ${discoveredProperties.length} properties.`,
            current: discoveredProperties.length,
            total: discoveredProperties.length,
          },
          updatedAt: new Date(),
        })
        .where(eq(importSessions.id, sessionId));

      console.log(`[ImportDiscovery] Completed for session ${sessionId}: ${discoveredProperties.length} properties discovered`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[ImportDiscovery] Failed for session ${sessionId}:`, errorMsg);

      // Update session as failed
      await db
        .update(importSessions)
        .set({
          status: "failed",
          errorMessage: errorMsg,
          updatedAt: new Date(),
        })
        .where(eq(importSessions.id, sessionId));
    } finally {
      // Always close browser
      if (browser) {
        try {
          await browser.close();
          console.log("[ImportDiscovery] Browser closed");
        } catch (closeErr) {
          console.error("[ImportDiscovery] Error closing browser:", closeErr);
        }
      }
    }
  },
  {
    connection,
    concurrency: 1, // One browser at a time per D-03 resource management
  },
);

worker.on("failed", (job, err) => {
  console.error(`[ImportDiscovery] Job ${job?.id} failed:`, err.message);
});

worker.on("completed", (job) => {
  console.log(`[ImportDiscovery] Job ${job.id} completed`);
});

export { worker as importDiscoveryWorker };
