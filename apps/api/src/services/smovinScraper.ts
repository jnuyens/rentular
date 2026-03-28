import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";

chromium.use(stealth());

function randomDelay(minMs = 1000, maxMs = 3000): Promise<void> {
  const delay = Math.floor(Math.random() * (maxMs - minMs)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

export async function createStealthBrowser(): Promise<{ browser: { close(): Promise<void> }; context: import("playwright-core").BrowserContext }> {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--no-sandbox",
    ],
  });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "fr-BE",
    timezoneId: "Europe/Brussels",
    viewport: { width: 1920, height: 1080 },
  });
  return { browser, context };
}

export async function loginToSmovin(
  page: Awaited<
    ReturnType<
      Awaited<ReturnType<typeof createStealthBrowser>>["context"]["newPage"]
    >
  >,
  email: string,
  password: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    // Navigate and wait for all resources (scripts) to download
    await page.goto("https://app.smovin.be/login", {
      waitUntil: "load",
      timeout: 60000,
    });
    console.log("[SmovinScraper] Page loaded, waiting for SPA hydration...");

    // Wait for the SPA JS to execute and render — try networkidle after load
    await page.waitForLoadState("networkidle").catch(() => {
      console.log("[SmovinScraper] networkidle timeout, continuing...");
    });
    await randomDelay(2000, 4000);

    // Check for Cloudflare challenge page
    const bodyText = await page.textContent("body");
    if (
      bodyText &&
      (bodyText.includes("Checking your browser") ||
        bodyText.includes("Just a moment") ||
        bodyText.includes("Verify you are human"))
    ) {
      console.log(
        "[SmovinScraper] Cloudflare challenge detected, waiting up to 30s...",
      );
      // Wait for challenge to resolve by waiting for any input to appear
      try {
        await page.waitForSelector("input", { timeout: 30000 });
      } catch {
        return { success: false, error: "cloudflare_blocked" };
      }
    }

    // Wait for SPA to hydrate and render the login form
    // Use broad selector: any input element as first sign of SPA rendering
    console.log("[SmovinScraper] Waiting for SPA to render login form...");
    const emailSelector =
      'input[type="email"], input[name="email"], input[id="email"], input[autocomplete="email"], input[placeholder*="mail" i]';
    const passwordSelector =
      'input[type="password"], input[name="password"], input[id="password"]';

    try {
      // First wait for ANY input to appear (SPA mounted)
      await page.waitForSelector("input", { timeout: 30000 });
      console.log("[SmovinScraper] SPA rendered — input elements detected");
      // Then wait specifically for email field
      await page.waitForSelector(emailSelector, { timeout: 10000 });
    } catch {
      // Log full page HTML from the end (body) for debugging
      const html = await page.content();
      // Find body content specifically
      const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
      const bodyHtml = bodyMatch ? bodyMatch[1] : html;
      console.log(
        "[SmovinScraper] Login form not found. Body HTML (first 3000 chars):",
        bodyHtml.substring(0, 3000),
      );
      return { success: false, error: "login_form_not_found" };
    }

    // Use Locator API (pressSequentially requires Locator, not ElementHandle)
    const emailLocator = page.locator(emailSelector).first();
    const passwordLocator = page.locator(passwordSelector).first();

    if ((await emailLocator.count()) === 0 || (await passwordLocator.count()) === 0) {
      return { success: false, error: "login_form_not_found" };
    }

    // Type with human-like keystroke simulation
    await emailLocator.click();
    await randomDelay(300, 600);
    await emailLocator.pressSequentially(email, { delay: 50 });
    await randomDelay(500, 1000);

    await passwordLocator.click();
    await randomDelay(300, 600);
    await passwordLocator.pressSequentially(password, { delay: 50 });
    await randomDelay(500, 1000);

    // Debug: log what we see before submitting
    console.log(`[SmovinScraper] URL before submit: ${page.url()}`);

    // Find and click submit button — broaden selectors for SPA frameworks
    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:has-text("Log in")',
      'button:has-text("Connexion")',
      'button:has-text("Inloggen")',
      'button:has-text("Se connecter")',
      "form button",
    ];
    let submitClicked = false;
    for (const sel of submitSelectors) {
      const btn = page.locator(sel).first();
      if ((await btn.count()) > 0) {
        const buttonText = await btn.textContent();
        console.log(`[SmovinScraper] Submit button found: "${buttonText?.trim()}"`);
        await btn.click();
        submitClicked = true;
        break;
      }
    }
    if (!submitClicked) {
      console.log("[SmovinScraper] No submit button found, pressing Enter");
      await passwordLocator.press("Enter");
    }

    // Wait for page to settle after submit
    console.log("[SmovinScraper] Waiting for post-login navigation...");
    await page.waitForTimeout(5000);
    await randomDelay(2000, 4000);

    // Debug: log post-login state
    const currentUrl = page.url();
    console.log(`[SmovinScraper] URL after submit: ${currentUrl}`);

    // Detect login success by checking for authenticated page indicators
    // (URL check is unreliable — Smovin uses /login as a post-auth route too)
    const pageText = await page.textContent("body").catch(() => "");
    const hasAuthIndicators =
      pageText !== null &&
      (pageText.includes("Dashboard") ||
        pageText.includes("Eigendommen") ||
        pageText.includes("Patrimoine") ||
        pageText.includes("Contracten") ||
        pageText.includes("Contrats") ||
        pageText.includes("Afmelden") ||
        pageText.includes("Déconnexion") ||
        pageText.includes("Account"));

    console.log(`[SmovinScraper] Auth indicators found: ${hasAuthIndicators}`);

    if (!hasAuthIndicators) {
      // Check for explicit error messages
      const errorText = await page
        .textContent('[class*="error"], [class*="alert"], [role="alert"]')
        .catch(() => null);
      if (errorText) {
        console.log(`[SmovinScraper] Error on page: "${errorText.trim()}"`);
      }

      // Still on sign_in form means credentials were rejected
      const hasLoginForm = (await page.locator('input[type="password"]').count()) > 0;
      if (hasLoginForm) {
        return { success: false, error: "login_failed" };
      }

      return { success: false, error: "login_failed" };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export { randomDelay };
