---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: Ready to execute
stopped_at: Completed 05-02-PLAN.md
last_updated: "2026-03-24T12:25:23.134Z"
progress:
  total_phases: 7
  completed_phases: 4
  total_plans: 19
  completed_plans: 16
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-22)

**Core value:** Landlords can automatically collect rent via SEPA direct debit and track all their properties in one affordable, multilingual platform.
**Current focus:** Phase 05 — property-manager-roles

## Current Position

Phase: 05 (property-manager-roles) — EXECUTING
Plan: 2 of 4

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**

- Last 5 plans: -
- Trend: -

*Updated after each plan completion*
| Phase 01 P02 | 2min | 2 tasks | 1 files |
| Phase 01 P01 | 3min | 2 tasks | 9 files |
| Phase 01 P03 | 2min | 2 tasks | 4 files |
| Phase 01 P05 | 2min | 2 tasks | 3 files |
| Phase 01 P04 | 6min | 2 tasks | 11 files |
| Phase 02 P01 | 2min | 2 tasks | 4 files |
| Phase 02 P03 | 3min | 2 tasks | 1 files |
| Phase 02 P02 | 3min | 2 tasks | 2 files |
| Phase 02 P04 | 5min | 2 tasks | 6 files |
| Phase 02 P05 | 3min | 2 tasks | 3 files |
| Phase 03 P01 | 2min | 2 tasks | 3 files |
| Phase 03 P02 | 5min | 2 tasks | 2 files |
| Phase 04 P01 | 5min | 3 tasks | 9 files |
| Phase 04 P02 | 4min | 2 tasks | 5 files |
| Phase 05 P02 | 3min | 2 tasks | 2 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Phases ordered to prioritize core value (payments) before expansion features (property managers, Smovin import)
- [Roadmap]: Smovin import treated as beta feature due to LOW confidence on scraping approach
- [Roadmap]: I18N-01 (full translation coverage) placed in final phase since it validates all prior phases
- [Phase 01]: Used Hono built-in csrf() middleware with ALLOWED_ORIGINS env var shared by both CORS and CSRF
- [Phase 01]: Health check verifies DB and Redis but skips SMTP (email is async via BullMQ)
- [Phase 01]: Used object-return callback format for Drizzle index definitions matching existing propertyManagers.ts convention
- [Phase 01]: Removed memoryStore fallback from properties, tenants, bankAccounts routes -- fail-fast on DB errors instead of silent degradation
- [Phase 01]: Added 401 auth guard to bankAccounts GET / endpoint after removing memoryStore fallback
- [Phase 01]: Full rewrite of leases.ts and maintenance.ts (100% memoryStore) to database; memoryStore.ts deleted
- [Phase 01]: Used static imports for DB access in route files instead of dynamic require() with memory-store fallback
- [Phase 01]: Phase marker format established: // Phase N: brief description of deferred work
- [Phase 02]: eventId unique constraint for DB-level webhook idempotency
- [Phase 02]: Provider-agnostic bank_connections table supporting GoCardless BAD, Ponto, Enable Banking
- [Phase 02]: Forward-jump state transitions allowed to handle out-of-order GoCardless webhook events
- [Phase 02]: Overdue summary route placed before /:id to avoid Hono route parameter conflict
- [Phase 02]: Manual payments immediately marked as paid (no state machine transition needed)
- [Phase 02]: GoCardless not configured returns 503 vs missing mandate returns 400 to distinguish infra vs data issues
- [Phase 02]: Webhook events inserted as processing before handler runs, updated to processed/failed after -- ensures audit trail even on crash
- [Phase 02]: Unknown GoCardless payments auto-created with amount 0.00 and review note (D-12), rather than silently discarding
- [Phase 02]: Mandate terminal events append timestamped note to lease.notes before clearing mandateId (D-13 lease flagging)
- [Phase 02]: Provider-agnostic BankAccountDataProvider interface supports future Ponto/Enable Banking swap
- [Phase 02]: GoCardless BAD silent renewal not supported; email warning at 7/1 day thresholds
- [Phase 02]: Transaction matching: digits-only normalization of structured communications for tolerance
- [Phase 02]: Payment overview uses in-memory aggregation after single Drizzle query for flexibility with ignored payment filtering
- [Phase 02]: Webhook cleanup runs weekly Sunday 03:00 following same BullMQ pattern as paymentCheckWorker
- [Phase 03]: Skip-if-exists upsert for health index: values never change once published by Statbel
- [Phase 03]: Silent failure on Statbel API errors with retry-next-day via daily cron (D-03)
- [Phase 03]: Shared calculateLeaseIndexation helper centralizes lease/property/index lookup across 3 endpoints
- [Phase 03]: Override rent capped at EPC-restricted maximum, base rent never modified (D-07/D-08)
- [Phase 04]: CommunicationMeta is optional third parameter on queueEmail/queueSms for backward compatibility
- [Phase 04]: Support chat endpoint skipped for communication logging (no authenticated user, ownerId is NOT NULL)
- [Phase 04]: Direct sendEmail calls replaced with queueEmail in landlordReportWorker and paymentCheckWorker for centralized logging
- [Phase 04]: SMTP transport cache stores transport + fromAddress/fromName together to avoid extra DB query on cache hit
- [Phase 04]: ownerId passed through email queue job data for per-landlord SMTP transport selection at send time
- [Phase 04]: Communications send endpoint relies on queueEmail/queueSms auto-logging instead of manual db.insert
- [Phase 05]: D-01 implemented as full auto-accept (sets userId + acceptedAt + clears token) for all pending invitations on first token accept
- [Phase 05]: Properties PATCH requires manager+ role, DELETE requires co_owner+ role -- graduated access replacing ownerId checks
- [Phase 05]: Removed memoryStore fallback from properties.ts -- fail-fast with typed DB imports

### Pending Todos

None yet.

### Blockers/Concerns

- [Research]: GoCardless webhook handlers return 200 OK without persisting state -- critical bug, addressed in Phase 2
- [Research]: Statbel beSTAT API has no SLA or versioning -- needs caching with manual fallback in Phase 3
- [Research]: Smovin scraping approach has LOW confidence -- Cloudflare anti-bot may block Playwright

## Session Continuity

Last session: 2026-03-24T12:25:23.125Z
Stopped at: Completed 05-02-PLAN.md
Resume file: None
