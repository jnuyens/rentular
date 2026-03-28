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
    timeout: 1800000, // 30 minutes
  },
});

// Discovered data types
interface SmovinDiscoveredProperty {
  name: string;
  address: string;
  type: string;
  tenants: Array<{ firstName: string; lastName: string; email?: string; phone?: string }>;
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
      await page.goto("https://web.smovin.app/patrimony", {
        waitUntil: "load",
        timeout: 60000,
      });
      await page.waitForLoadState("networkidle").catch(() => {
        console.log("[ImportDiscovery] networkidle timeout on patrimony page, continuing...");
      });
      await randomDelay(2000, 4000);

      await updateProgress("properties", "Discovering properties...");

      // 5. Scrape property list
      const discoveredProperties: SmovinDiscoveredProperty[] = [];

      // Try to find property links/cards on the patrimony page
      // Smovin likely renders properties as cards or list items with links
      try {
        // Wait for content to render
        await page.waitForSelector("a[href*='/patrimony/'], a[href*='/property/'], table tr, [class*='card'], [class*='property']", {
          timeout: 15000,
        }).catch(() => {
          console.log("[ImportDiscovery] No property elements found with specific selectors, trying broader search...");
        });

        // Try to find property links - multiple selector strategies
        let propertyLinks: string[] = [];

        // Strategy 1: Links containing patrimony/ with a property ID
        const patrimonyLinks = await page.$$eval(
          "a[href*='/patrimony/']",
          (links: HTMLAnchorElement[]) =>
            links
              .map((a) => a.href)
              .filter((href) => /\/patrimony\/\d+/.test(href)),
        ).catch(() => [] as string[]);

        if (patrimonyLinks.length > 0) {
          propertyLinks = [...new Set(patrimonyLinks)];
        }

        // Strategy 2: Links containing property/
        if (propertyLinks.length === 0) {
          const propLinks = await page.$$eval(
            "a[href*='/property/']",
            (links: HTMLAnchorElement[]) =>
              links
                .map((a) => a.href)
                .filter((href) => /\/property\/\d+/.test(href)),
          ).catch(() => [] as string[]);

          if (propLinks.length > 0) {
            propertyLinks = [...new Set(propLinks)];
          }
        }

        // Strategy 3: Try table rows if no links found
        if (propertyLinks.length === 0) {
          const tableRows = await page.$$eval(
            "table tbody tr",
            (rows: HTMLTableRowElement[]) =>
              rows.map((row) => {
                const link = row.querySelector("a");
                return link ? link.href : "";
              }).filter(Boolean),
          ).catch(() => [] as string[]);

          if (tableRows.length > 0) {
            propertyLinks = [...new Set(tableRows)];
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
            // Navigate to property detail page
            await page.goto(propertyUrl, { waitUntil: "load", timeout: 30000 });
            await page.waitForLoadState("networkidle").catch(() => {});
            await randomDelay(1500, 3000);

            // Extract property name and address
            // Try common heading patterns
            property.name = await page
              .textContent("h1, h2, [class*='title'], [class*='name']")
              .then((t) => t?.trim() || `Property ${i + 1}`)
              .catch(() => `Property ${i + 1}`);

            property.address = await page
              .textContent("[class*='address'], [class*='location'], [class*='adres']")
              .then((t) => t?.trim() || "")
              .catch(() => "");

            // Try to determine property type
            property.type = await page
              .textContent("[class*='type'], [class*='category']")
              .then((t) => t?.trim() || "unknown")
              .catch(() => "unknown");

            // 7. Scrape tenants/contacts
            try {
              // Look for tenant/contact sections
              const tenantSection = page.locator("text=Huurder, text=Locataire, text=Tenant, text=Contact").first();
              if ((await tenantSection.count()) > 0) {
                await tenantSection.click().catch(() => {});
                await randomDelay(1000, 2000);
              }

              // Try table-based tenant extraction
              const tenantRows = await page.$$eval(
                "table tr",
                (rows: HTMLTableRowElement[]) =>
                  rows.slice(1).map((row) => {
                    const cells = Array.from(row.querySelectorAll("td"));
                    return cells.map((c) => c.textContent?.trim() || "");
                  }),
              ).catch(() => [] as string[][]);

              for (const row of tenantRows) {
                if (row.length >= 2) {
                  // Try to parse name into first/last
                  const nameParts = row[0].split(" ");
                  property.tenants.push({
                    firstName: nameParts[0] || "",
                    lastName: nameParts.slice(1).join(" ") || "",
                    email: row.find((cell) => cell.includes("@")) || undefined,
                    phone: row.find((cell) => /[\d\s+]{8,}/.test(cell)) || undefined,
                  });
                }
              }
            } catch (tenantErr) {
              console.log(`[ImportDiscovery] Could not scrape tenants for property ${i + 1}:`, tenantErr);
            }

            // 8. Scrape leases/contracts
            try {
              // Navigate to contracts sub-page if available
              const contractLink = page.locator("a:has-text('Contract'), a:has-text('Contrat'), a:has-text('Lease'), a:has-text('Bail')").first();
              if ((await contractLink.count()) > 0) {
                await contractLink.click();
                await randomDelay(1500, 3000);
                await page.waitForLoadState("networkidle").catch(() => {});
              }

              // Try to extract lease data from tables or detail sections
              const leaseData = await page.$$eval(
                "table tr",
                (rows: HTMLTableRowElement[]) =>
                  rows.slice(1).map((row) => {
                    const cells = Array.from(row.querySelectorAll("td"));
                    return cells.map((c) => c.textContent?.trim() || "");
                  }),
              ).catch(() => [] as string[][]);

              for (const row of leaseData) {
                if (row.length >= 2) {
                  // Extract date patterns (DD/MM/YYYY or YYYY-MM-DD)
                  const dates = row.filter((cell) => /\d{2}[/.-]\d{2}[/.-]\d{4}|\d{4}[/.-]\d{2}[/.-]\d{2}/.test(cell));
                  // Extract amount patterns
                  const amounts = row.filter((cell) => /[\d.,]+\s*[EUR€]|[EUR€]\s*[\d.,]+|^\d+[.,]\d{2}$/.test(cell));

                  property.leases.push({
                    startDate: dates[0] || "",
                    endDate: dates[1] || undefined,
                    monthlyRent: amounts[0] || "",
                    charges: amounts[1] || undefined,
                    type: row.find((cell) => /bail|huur|lease|contract/i.test(cell)) || undefined,
                  });
                }
              }
            } catch (leaseErr) {
              console.log(`[ImportDiscovery] Could not scrape leases for property ${i + 1}:`, leaseErr);
            }

            // 9. Scrape payments if accessible
            try {
              // Navigate to payments/management sub-page
              const paymentLink = page.locator("a:has-text('Paiement'), a:has-text('Betaling'), a:has-text('Payment'), a:has-text('Gestion')").first();
              if ((await paymentLink.count()) > 0) {
                await paymentLink.click();
                await randomDelay(1500, 3000);
                await page.waitForLoadState("networkidle").catch(() => {});
              }

              const paymentRows = await page.$$eval(
                "table tr",
                (rows: HTMLTableRowElement[]) =>
                  rows.slice(1).map((row) => {
                    const cells = Array.from(row.querySelectorAll("td"));
                    return cells.map((c) => c.textContent?.trim() || "");
                  }),
              ).catch(() => [] as string[][]);

              for (const row of paymentRows) {
                if (row.length >= 2) {
                  const dates = row.filter((cell) => /\d{2}[/.-]\d{2}[/.-]\d{4}|\d{4}[/.-]\d{2}[/.-]\d{2}/.test(cell));
                  const amounts = row.filter((cell) => /[\d.,]+\s*[EUR€]|[EUR€]\s*[\d.,]+|^\d+[.,]\d{2}$/.test(cell));
                  const statusKeywords = ["paid", "unpaid", "overdue", "pending", "payé", "impayé", "betaald", "onbetaald", "en retard"];
                  const status = row.find((cell) => statusKeywords.some((kw) => cell.toLowerCase().includes(kw))) || "unknown";

                  property.payments.push({
                    date: dates[0] || "",
                    amount: amounts[0] || "",
                    status,
                    description: row.find((cell) => cell.length > 10 && !dates.includes(cell) && !amounts.includes(cell)) || undefined,
                  });
                }
              }
            } catch (paymentErr) {
              console.log(`[ImportDiscovery] Could not scrape payments for property ${i + 1}:`, paymentErr);
            }

            // Navigate back to property list for next iteration
            await page.goto("https://web.smovin.app/patrimony", {
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
