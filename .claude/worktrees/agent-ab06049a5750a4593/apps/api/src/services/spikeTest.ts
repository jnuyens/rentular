/**
 * Spike Test: Validate Smovin Login with Stealth Playwright (D-02 Hard Gate)
 *
 * Run with:
 *   SMOVIN_EMAIL=your@email.com SMOVIN_PASSWORD=yourpass npx tsx apps/api/src/services/spikeTest.ts
 *
 * This is the hard gate for Phase 6. If Cloudflare blocks the stealth browser,
 * the entire Smovin import phase stops for reassessment per D-02.
 */

import { createStealthBrowser, loginToSmovin } from "./smovinScraper";

async function runSpikeTest(): Promise<void> {
  const email = process.env.SMOVIN_EMAIL;
  const password = process.env.SMOVIN_PASSWORD;

  if (!email || !password) {
    console.error(
      "[SpikeTest] Missing SMOVIN_EMAIL or SMOVIN_PASSWORD environment variables.",
    );
    console.error(
      "Usage: SMOVIN_EMAIL=your@email.com SMOVIN_PASSWORD=yourpass npx tsx apps/api/src/services/spikeTest.ts",
    );
    process.exit(1);
  }

  console.log("[SpikeTest] Starting Smovin login spike test...");
  console.log(`[SpikeTest] Email: ${email}`);

  const { browser, context } = await createStealthBrowser();
  const page = await context.newPage();

  try {
    console.log("[SpikeTest] Navigating to Smovin login page...");
    const result = await loginToSmovin(page, email, password);

    if (!result.success) {
      console.error(`[SpikeTest] Login failed with error: ${result.error}`);

      if (result.error === "cloudflare_blocked") {
        console.error(
          "[SpikeTest] Cloudflare anti-bot detected and blocked the stealth browser.",
        );
        console.error(
          "[SpikeTest] Phase 6 cannot proceed. Reassess scraping strategy per D-02.",
        );
      } else if (result.error === "login_form_not_found") {
        console.error(
          "[SpikeTest] Could not find the login form on the page. Check page structure.",
        );
      } else if (result.error === "login_failed") {
        console.error(
          "[SpikeTest] Login credentials were rejected. Verify email/password.",
        );
      }

      console.log("\nSpike test FAILED");
      return;
    }

    console.log("[SpikeTest] Login succeeded! Navigating to properties...");
    const currentUrl = page.url();
    console.log(`[SpikeTest] Current URL after login: ${currentUrl}`);

    // Try to navigate to properties/patrimony section
    // Smovin uses French UI by default, try common navigation paths
    const propertyUrls = [
      "https://app.smovin.be/patrimony",
      "https://app.smovin.be/properties",
      "https://app.smovin.be/buildings",
    ];

    let foundProperties = false;
    for (const url of propertyUrls) {
      try {
        console.log(`[SpikeTest] Trying to navigate to ${url}...`);
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
        const pageTitle = await page.title();
        const pageUrl = page.url();
        console.log(
          `[SpikeTest] Page title: "${pageTitle}", URL: ${pageUrl}`,
        );

        // If we weren't redirected back to login, this might be valid
        if (!pageUrl.includes("login")) {
          foundProperties = true;
          break;
        }
      } catch {
        console.log(`[SpikeTest] Could not navigate to ${url}, trying next...`);
      }
    }

    if (foundProperties) {
      // Extract first property name/address from the page
      console.log("[SpikeTest] Attempting to extract property data...");

      // Try to find property cards or list items
      const propertyElements = await page.$$(
        'table tbody tr, .property-card, [class*="property"], [class*="building"]',
      );
      console.log(
        `[SpikeTest] Found ${propertyElements.length} potential property elements`,
      );

      if (propertyElements.length > 0) {
        const firstPropertyText = await propertyElements[0].textContent();
        console.log(
          `[SpikeTest] First property text: ${firstPropertyText?.substring(0, 200)}`,
        );
      }

      // Also try to extract from page content
      const bodyText = await page.textContent("body");
      if (bodyText) {
        console.log(
          `[SpikeTest] Page body (first 500 chars): ${bodyText.substring(0, 500)}`,
        );
      }
    } else {
      console.log(
        "[SpikeTest] Could not find properties section, but login succeeded.",
      );
      console.log(
        "[SpikeTest] This is still a PASS -- the critical gate is Cloudflare bypass + login.",
      );
    }

    console.log("\nSpike test PASSED");
  } catch (err) {
    console.error(`[SpikeTest] Unexpected error: ${err}`);
    console.log("\nSpike test FAILED");
  } finally {
    await page.close();
    await context.close();
    await browser.close();
    console.log("[SpikeTest] Browser closed.");
  }
}

runSpikeTest();
