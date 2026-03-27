import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";

chromium.use(stealth());

function randomDelay(minMs = 1000, maxMs = 3000): Promise<void> {
  const delay = Math.floor(Math.random() * (maxMs - minMs)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

export async function createStealthBrowser() {
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
    await page.goto("https://app.smovin.be/login", {
      waitUntil: "networkidle",
    });
    await randomDelay(1500, 3000);

    // Check for Cloudflare challenge page
    const bodyText = await page.textContent("body");
    if (
      bodyText &&
      (bodyText.includes("Checking your browser") ||
        bodyText.includes("Just a moment"))
    ) {
      // Wait up to 15 seconds for Cloudflare challenge to resolve
      await page.waitForNavigation({ timeout: 15000 }).catch(() => {});
      await randomDelay(2000, 4000);
      const afterChallengeText = await page.textContent("body");
      if (
        afterChallengeText &&
        (afterChallengeText.includes("Checking your browser") ||
          afterChallengeText.includes("Just a moment"))
      ) {
        return { success: false, error: "cloudflare_blocked" };
      }
    }

    // Find and fill login form - try common selectors
    const emailInput = await page.$(
      'input[type="email"], input[name="email"], input[id="email"]',
    );
    const passwordInput = await page.$(
      'input[type="password"], input[name="password"], input[id="password"]',
    );

    if (!emailInput || !passwordInput) {
      // Log page HTML for debugging
      const html = await page.content();
      console.log(
        "[SmovinScraper] Login form not found. Page HTML (first 2000 chars):",
        html.substring(0, 2000),
      );
      return { success: false, error: "login_form_not_found" };
    }

    // Type with human-like delays
    await emailInput.click();
    await randomDelay(300, 600);
    await emailInput.fill(email);
    await randomDelay(500, 1000);

    await passwordInput.click();
    await randomDelay(300, 600);
    await passwordInput.fill(password);
    await randomDelay(500, 1000);

    // Find and click submit button
    const submitButton = await page.$(
      'button[type="submit"], input[type="submit"]',
    );
    if (submitButton) {
      await submitButton.click();
    } else {
      await passwordInput.press("Enter");
    }

    // Wait for navigation after login
    await page.waitForNavigation({ timeout: 15000 }).catch(() => {});
    await randomDelay(2000, 4000);

    // Check if login succeeded by looking for dashboard indicators
    const currentUrl = page.url();
    if (currentUrl.includes("login")) {
      return { success: false, error: "login_failed" };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export { randomDelay };
