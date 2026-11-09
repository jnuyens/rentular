/**
 * Canonical public base URL for the site, used by metadata (metadataBase),
 * the sitemap, and robots. Resolution order:
 *   1. NEXT_PUBLIC_SITE_URL (explicit override)
 *   2. WEB_URL (server env used elsewhere in the stack)
 *   3. production default (canonical host)
 * Trailing slash is stripped so callers can safely append paths.
 */
export function getBaseUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.WEB_URL ||
    "https://www.rentular.com";
  return raw.replace(/\/+$/, "");
}

/** Contact shown under "Need help?" when SUPPORT_EMAIL is not set. */
export const DEFAULT_SUPPORT_EMAIL = "privacy@rentular.com";

/** Support address from SUPPORT_EMAIL, else the public contact address. Server only. */
export function getSupportEmail(): string {
  return process.env.SUPPORT_EMAIL?.trim() || DEFAULT_SUPPORT_EMAIL;
}
