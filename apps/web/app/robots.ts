import type { MetadataRoute } from "next";
import { getBaseUrl } from "@/lib/site";

// Private, auth-gated areas that must not be crawled or indexed. These are the
// real URL paths (the (dashboard)/(auth) route groups do not appear in URLs).
const DISALLOW = [
  "/properties",
  "/tenants",
  "/leases",
  "/payments",
  "/settings",
  "/bank-connections",
  "/mandates",
  "/communications",
  "/indexation",
  "/maintenance",
  "/reconciliation",
  "/import",
  "/onboarding",
  "/login",
  "/invite",
  "/api",
];

// AI crawlers we explicitly welcome onto the public pages. Listing them keeps
// the intent legible and guards against a future blanket block: Rentular wants
// to be indexed by AI search and answer engines.
const AI_AGENTS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-Web",
  "anthropic-ai",
  "Google-Extended",
  "PerplexityBot",
  "Applebot-Extended",
  "CCBot",
  "Amazonbot",
  "cohere-ai",
];

export default function robots(): MetadataRoute.Robots {
  const base = getBaseUrl();
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: DISALLOW },
      { userAgent: AI_AGENTS, allow: "/", disallow: DISALLOW },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
