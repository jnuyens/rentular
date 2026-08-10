---
quick_id: 260810-e8q
description: ensure sitemap and robots.txt allowing AI indexation and SEO
status: complete
completed: 2026-08-10
---

# Quick Task 260810-e8q — Summary

## Result

The Next.js web app now serves `/sitemap.xml` and `/robots.txt` (App Router metadata
routes), built and verified. AI crawlers are explicitly allowed; private auth-gated paths
are blocked. Commit `2e24e8d`.

## What was added

- **`apps/web/app/sitemap.ts`** — `MetadataRoute.Sitemap` listing the public pages only
  (`/`, `/terms`, `/privacy`) with absolute canonical URLs, `lastModified`, changeFrequency,
  and priority. Dashboard/auth pages are intentionally excluded (they are private).
- **`apps/web/app/robots.ts`** — `MetadataRoute.Robots` with:
  - `User-agent: *` → `Allow: /`, `Disallow:` every auth-gated path (`/properties`, `/tenants`,
    `/leases`, `/payments`, `/settings`, `/bank-connections`, `/mandates`, `/communications`,
    `/indexation`, `/maintenance`, `/reconciliation`, `/import`, `/onboarding`, `/login`,
    `/invite`, `/api`).
  - An explicit group for AI crawlers (GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot,
    Claude-Web, anthropic-ai, Google-Extended, PerplexityBot, Applebot-Extended, CCBot,
    Amazonbot, cohere-ai) with the same allow/disallow — documents that AI indexing of the
    public pages is welcome and guards against a future blanket block.
  - `Host` + `Sitemap` directives pointing at the canonical URL.
- **`apps/web/lib/site.ts`** — `getBaseUrl()` resolving `NEXT_PUBLIC_SITE_URL` → `WEB_URL`
  → `https://www.rentular.com` (trailing slash stripped). Single source of truth for
  sitemap, robots, and metadataBase.
- **`apps/web/app/layout.tsx`** — added `metadataBase: new URL(getBaseUrl())` and
  `alternates.canonical: "/"` so OG/canonical URLs resolve absolutely (SEO correctness).
- **`.env.example`** — documented the optional `NEXT_PUBLIC_SITE_URL`.

## Verification

- `pnpm --filter @rentular/web build` → success; route table shows `○ /robots.txt` and
  `○ /sitemap.xml` as static routes.
- Inspected the emitted `.next/server/app/{robots.txt,sitemap.xml}.body`: robots.txt lists
  the `*` and AI-agent groups with correct allow/disallow + `Host`/`Sitemap`; sitemap.xml is
  valid XML with the 3 public URLs (absolute, `https://www.rentular.com/...`).

## Notes

- Base URL resolved to the `https://www.rentular.com` default in the local build because
  `NEXT_PUBLIC_SITE_URL`/`WEB_URL` were unset. In prod, set `NEXT_PUBLIC_SITE_URL` (or rely on
  `WEB_URL`) so the values match the deployed host.
- The build printed a pre-existing warning about copying `(marketing)/page_client-reference-manifest.js`
  into `.next/standalone` — a known Next 15 standalone + route-group quirk, unrelated to these
  static SEO routes (both emitted correctly). The current prod deploy runs `next start`, not the
  standalone output, so it is not blocking.
