# Phase 1: Security & Infrastructure Foundation - Context

**Gathered:** 2026-03-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Harden the backend foundation: CSRF protection, type-safe database access, database indexes, TODO stub cleanup, real DB wiring for all existing endpoints, and maintenance task persistence. All subsequent phases build on this foundation.

</domain>

<decisions>
## Implementation Decisions

### CSRF Protection
- **D-01:** Use Origin/Referer header validation against an environment variable allowlist (`ALLOWED_ORIGINS`)
- **D-02:** No frontend changes required — validation happens server-side in Hono middleware
- **D-03:** Allowlist supports multiple origins (production, staging, localhost for development)
- **D-04:** API key authentication is deferred — not in Phase 1 scope

### TODO Stub Cleanup
- **D-05:** Replace TODO stubs with explicit phase markers (e.g., `// Phase 2: implement payment persistence`) — do not delete the route scaffolding
- **D-06:** Stubs in webhooks.ts and gocardless.ts are marked as Phase 2
- **D-07:** Stubs in propertyManagers.ts are marked as Phase 5
- **D-08:** Route structure and handler signatures are preserved for downstream phases to build on

### In-Memory Store Removal
- **D-09:** Remove ALL in-memory store fallbacks from every route — API returns 500 if DB is down
- **D-10:** Delete `memoryStore.ts` entirely — no dead code
- **D-11:** Convert all route files to static typed Drizzle imports in a single sweep (eliminates all `any` typing on DB imports)
- **D-12:** Add `GET /health` endpoint that checks DB + Redis connectivity (not SMTP — email failures are handled by the queue)

### Database Wiring
- **D-13:** Wire costs, rent adjustments, communications, and maintenance routes to real database queries (replacing in-memory store usage)
- **D-14:** Add `maintenance` table to the Drizzle schema for persisting auto-generated and custom maintenance tasks
- **D-15:** Maintenance tasks are stored in DB after auto-generation (not recalculated on-the-fly)

### Database Indexes
- **D-16:** Add indexes for common query patterns: payments by lease+status, properties by owner, tenants by owner, leases by owner+property
- **D-17:** Verify index usage via EXPLAIN on key queries

### Lease Types
- **D-18:** Schema already supports residential (short/long/lifetime), student, and commercial lease types — no changes needed
- **D-19:** Regional enum (flanders/wallonia/brussels) already in place — no changes needed

### Maintenance Reminders
- **D-20:** Current auto-generated task set is complete for v1: fire alarm inspection, heating maintenance, chimney sweep
- **D-21:** Tasks track: type, name, intervalMonths, nextDue, status, autoEmail, lastCompleted

### Claude's Discretion
- CSRF middleware implementation details (exact Hono middleware structure)
- Maintenance table schema column types and defaults
- Index selection beyond the explicitly listed query patterns
- Health check response format
- Error response format when DB/Redis is down

</decisions>

<specifics>
## Specific Ideas

- Origin check should use an env var (`ALLOWED_ORIGINS`) so dev/staging/production work without code changes
- Health check covers DB + Redis only (not SMTP) — email delivery is async via BullMQ and failures are already handled by the queue
- The `any` typing elimination is a direct consequence of removing the dynamic try/catch import pattern — static imports give proper types for free

</specifics>

<canonical_refs>
## Canonical References

No external specs — requirements are fully captured in decisions above and in the following planning artifacts:

### Requirements
- `.planning/REQUIREMENTS.md` — SEC-01, SEC-02, INF-01 through INF-05, LSE-01, LSE-02 requirement definitions

### Codebase Analysis
- `.planning/codebase/ARCHITECTURE.md` — Layer structure, entry points, error handling patterns
- `.planning/codebase/CONCERNS.md` — Known issues including `any` typing, memory store fallbacks
- `.planning/codebase/INTEGRATIONS.md` — GoCardless, Stripe, BullMQ integration details

### Database Schema
- `packages/db/src/schema/` — All existing table definitions (properties, tenants, leases, payments, communications, costs, etc.)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `apps/api/src/lib/authMiddleware.ts` — Auth middleware pattern to extend with CSRF check
- `packages/db/src/schema/` — Existing Drizzle schema to add maintenance table and indexes to
- `apps/api/src/routes/maintenance.ts` — Auto-generation logic (fire alarm, heating, chimney) to preserve when wiring to DB
- `apps/api/src/routes/costs.ts` — Costs + rent-free periods + deductions routes ready to wire to DB
- `apps/api/src/routes/rentAdjustments.ts` — Free periods and deductions routes ready to wire to DB
- `apps/api/src/routes/communications.ts` — Communication logging routes ready to wire to DB

### Established Patterns
- All routes follow: Hono router → Zod validation → DB query → JSON response
- Auth middleware attaches userId to Hono context, `getRequiredUserId()` for protected routes
- `requireAuth` middleware guards all `/properties`, `/tenants`, `/leases`, etc. prefixes
- BullMQ workers auto-start on import (emailQueueWorker, smsQueueWorker)

### Integration Points
- CSRF middleware slots in alongside existing `authMiddleware` in `apps/api/src/index.ts`
- Health check endpoint mounts at root level in `apps/api/src/index.ts`
- Maintenance schema adds to `packages/db/src/schema/` alongside existing tables
- Database indexes added via Drizzle migration in `packages/db/`

</code_context>

<deferred>
## Deferred Ideas

- API key authentication for non-browser clients — future phase when mobile/integrations needed
- SMTP health monitoring — not needed since email delivery is async via BullMQ
- Memory store as optional dev utility — decided against, use a real local DB instead

</deferred>

---

*Phase: 01-security-infrastructure*
*Context gathered: 2026-03-22*
