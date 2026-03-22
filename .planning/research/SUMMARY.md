# Research Summary: Rentular Launch Completion

**Domain:** Belgian rental property management platform — missing features for launch
**Researched:** 2026-03-22
**Overall confidence:** MEDIUM-HIGH

## Executive Summary

Rentular has a solid technical foundation (Next.js 15, Hono, Drizzle ORM, MySQL, BullMQ, GoCardless, Stripe) but is currently non-functional for its core value proposition: automated rent collection and tracking. The critical gap is that GoCardless webhook handlers acknowledge events without persisting state, silently losing all payment data. This single issue blocks payment tracking, reminders, reports, and indexation features.

The good news is that most missing functionality requires no new infrastructure. The existing BullMQ + Redis setup handles background jobs. The existing Drizzle ORM handles database operations. Hono's built-in CSRF middleware (available since v3.12.0) covers security. The Belgian health index is accessible via a free, unauthenticated REST API from Statbel's beSTAT platform. The only genuinely new dependencies needed are: Playwright (for Smovin import scraping), pino + hono-pino (for structured logging with secret redaction), and Twilio SDK (for SMS delivery).

The Smovin data import feature is the highest-risk item. It requires web scraping an authenticated SPA behind Cloudflare. This is inherently fragile and should be treated as a "best effort" beta feature, not a launch blocker. The Belgian health index integration has medium risk — the beSTAT API works and returns JSON but has no documented SLA or versioning. A caching layer with manual fallback mitigates this.

Regional EPC indexation restrictions (Brussels permanent penalties, Flanders correction factors, Wallonia exempt) are already implemented in code but return zero values because the health index data feed doesn't exist yet. Wiring the Statbel API to the existing calculation logic is straightforward.

## Key Findings

**Stack:** No major new dependencies needed. Add pino (logging), hono-pino (middleware), Playwright (Smovin scraping), Twilio (SMS), @headlessui/react (mobile drawer), uuid (idempotency keys). Total: 6 new packages.

**Architecture:** Existing Hono + BullMQ + Drizzle architecture is the right fit. New features slot into existing patterns: services for business logic, BullMQ workers for async operations, Drizzle schemas for new tables. Need to add a `webhook_events` idempotency table and a `health_index_cache` table.

**Critical pitfall:** GoCardless webhook handlers returning 200 OK without persisting any state. Every payment event is silently lost. This is the single most impactful bug in the codebase and must be fixed first.

## Implications for Roadmap

Based on research, suggested phase structure:

1. **Security & Observability Foundation** — Setup phase
   - Addresses: CSRF protection, structured logging, in-memory fallback removal
   - Avoids: CVE-2024-48913 CSRF bypass, secret leakage in logs, silent data loss from memory stores
   - Rationale: These are prerequisites that every subsequent phase depends on. Low effort, high impact.

2. **Payment Processing & Webhooks** — Core value delivery
   - Addresses: Webhook persistence, idempotency tracking, payment CRUD, GoCardless collection triggering
   - Avoids: Silent payment data loss, duplicate event processing, SEPA chargeback handling gaps
   - Rationale: This is the #1 blocking issue. Nothing else works without payment state in the database. The webhook handler code structure already exists — it needs implementation, not design.

3. **Belgian Health Index & Rent Indexation** — Market differentiator
   - Addresses: Statbel API integration, health index caching, indexation calculation wiring, EPC-aware calculations
   - Avoids: Base year mismatch, regional EPC misapplication, API instability
   - Rationale: Independent of payment processing. The calculation logic and EPC restriction code already exist in `indexation.ts`. Just needs the data feed (Statbel API) and lease data wiring.

4. **Notifications & Payment Follow-Up** — Automation delivery
   - Addresses: Email delivery via Nodemailer, SMS via Twilio, payment reminder escalation, indexation notifications
   - Avoids: SMTP deliverability issues (SPF/DKIM/DMARC), rate limiting failures
   - Rationale: Depends on Phase 2 (needs payment data to know what's overdue). BullMQ worker infrastructure exists — this phase wires it to actual sending.

5. **Responsive Design & UI Polish** — Launch readiness
   - Addresses: Mobile dashboard, off-canvas sidebar, responsive tables, visual consistency
   - Avoids: Breakpoint inconsistency across pages
   - Rationale: Can be done in parallel with Phases 3-4. Uses existing Tailwind CSS + new @headlessui/react for accessible mobile drawer.

6. **Smovin Import (Beta)** — Competitive advantage
   - Addresses: Authenticated web scraping of Smovin accounts, data mapping, import flow
   - Avoids: Credential storage risks, scraper fragility, Cloudflare blocking
   - Rationale: Highest risk, highest uncertainty. Should not block launch. Ship as beta with clear "best effort" messaging. Requires Playwright + stealth plugin.

7. **Property Manager Roles** — Post-launch expansion
   - Addresses: RBAC middleware, invitation flow, scoped dashboard views
   - Avoids: ownerId-only authorization breaking for shared properties
   - Rationale: Complex feature that affects all existing routes. Most initial users are solo landlords. Better to launch without it and add as first post-launch milestone.

**Phase ordering rationale:**
- Phases 1-2 are strictly sequential (security first, then payments)
- Phase 3 can run in parallel with Phase 2 (independent feature)
- Phase 4 depends on Phase 2 completion (needs payment data)
- Phase 5 can run in parallel with Phases 3-4 (UI work, independent of backend)
- Phase 6 should be last before launch (highest risk, lowest priority for MVP)
- Phase 7 is post-launch (complex, not needed for solo landlords)

**Research flags for phases:**
- Phase 2: Standard GoCardless patterns, well-documented. Unlikely to need more research.
- Phase 3: May need deeper research on Statbel API response format edge cases. The API has no versioning, so format changes could break parsing. LOW confidence on API stability.
- Phase 6: Will definitely need research-during-implementation. Smovin's page structure is unknown and could change. Cloudflare anti-bot measures may require experimentation.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All recommended libraries are well-established (pino, Playwright, Twilio, Headless UI). Versions verified via npm. |
| Features | HIGH | Feature landscape is well-defined by PROJECT.md. Dependencies between features are clear. |
| Architecture | HIGH | Existing architecture is sound. New features fit into established patterns (services, BullMQ workers, Drizzle schemas). |
| Pitfalls | HIGH | Critical pitfalls (webhook data loss, CSRF bypass) are verified against codebase and CVE databases. |
| Statbel API | MEDIUM | API endpoint works and returns JSON. But no SLA, no versioning, no rate limit docs. Could change without notice. |
| Smovin import | LOW | No confirmed public API. Scraping approach is inferred from general SPA patterns. Smovin's exact page structure and anti-bot measures are unknown. |
| Belgian law/indexation | MEDIUM | Indexation formula verified via official Statbel rent calculator. EPC rules verified for Brussels. Flanders correction factor logic in code matches published rules. Wallonia rules may evolve. |

## Gaps to Address

- **Statbel API format validation:** The beSTAT API returns health index data in JSON, but the exact field names and structure should be validated against the live API during Phase 3 implementation. A response schema validator is recommended.
- **Smovin page structure discovery:** Phase 6 will require exploratory scraping to map Smovin's navigation, data pages, and export capabilities. This cannot be fully planned in advance.
- **Flanders EPC future restrictions:** The code references 2028 and 2030 EPC bans. These dates and affected labels should be re-verified against current Flemish legislation when implementing Phase 3.
- **SMS pricing for Belgium:** Twilio's exact per-message cost for Belgian numbers was not confirmed. Verify pricing before committing to a provider.
- **GoCardless idempotency key retention:** GoCardless guarantees idempotency keys are honored for 30 days. The webhook_events table should retain records indefinitely for audit, but the 30-day window affects retry behavior.
- **NextAuth.js upgrade path:** The project uses NextAuth v5.0.0-beta.25. A stable v5 release may introduce breaking changes. Monitor for GA release.

---
*Research summary for: Rentular launch completion*
*Researched: 2026-03-22*
