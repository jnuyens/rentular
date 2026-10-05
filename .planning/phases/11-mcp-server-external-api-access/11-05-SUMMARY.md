---
phase: 11-mcp-server-external-api-access
plan: 05
subsystem: web
tags: [settings-ui, api-tokens, personal-access-token, next-intl, show-once, i18n]

# Dependency graph
requires:
  - phase: 11-mcp-server-external-api-access
    plan: 02
    provides: "owner-scoped, session-only /api-tokens router (GET list, POST show-once create, DELETE revoke) returning ApiTokenPublic"
provides:
  - "apps/web/components/ApiTokensCard.tsx: token list, create (name, scope, expiry), show-once dialog with copy, revoke confirm"
  - "api-tokens tab in apps/web Settings rendering ApiTokensCard"
  - "34 settings.* i18n keys in en, nl, fr, de for the token UI"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Show-once secret: plaintext held only in a React state variable (newToken), cleared on dialog close, never written to localStorage, URL or the list (T-11-10)"
    - "Clipboard copy with a text-selection fallback via a ref when navigator.clipboard is unavailable"

key-files:
  created:
    - apps/web/components/ApiTokensCard.tsx
  modified:
    - apps/web/app/(dashboard)/settings/page.tsx
    - apps/web/messages/en/common.json
    - apps/web/messages/nl/common.json
    - apps/web/messages/fr/common.json
    - apps/web/messages/de/common.json

key-decisions:
  - "Scope select defaults to read; read+write must be chosen deliberately (T-11-15)"
  - "Revoke sits behind an AlertDialog that names the token (T-11-16)"
  - "Plaintext token lives only in newToken state and is cleared on dialog close (T-11-10)"

requirements-completed: [API-03]

# Metrics
duration: 4min
completed: 2026-10-05
---

# Phase 11 Plan 05: Settings Token-Management UI Summary

**A new Settings "API tokens" tab rendering ApiTokensCard: it lists tokens, creates one (name, read / read+write scope, optional 30/90/365 day expiry), reveals the plaintext rtl_ token exactly once in a dialog with copy-to-clipboard, and revokes behind a naming confirmation, all in en, nl, fr and de.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-10-05T04:19:24Z
- **Completed:** 2026-10-05T04:23:08Z
- **Tasks:** 2
- **Files modified:** 6 (1 created, 5 modified)

## Accomplishments
- Built `ApiTokensCard({ apiUrl })` as a `"use client"` component driven entirely through `useTranslations("settings")`: GET list on mount, POST create, DELETE revoke, all with `credentials: "include"`.
- Create form: name Input (maxLength 120), scope Select defaulting to `read` with `read`/`write`, expiry Select offering no-expiry plus 30/90/365 days (sent as `expiresInDays` number or omitted).
- Show-once AlertDialog bound to `newToken`: monospace selectable block, a Copy button using `navigator.clipboard.writeText` with a selection fallback, and a single Done action that clears the plaintext from state.
- Token table with name, scope badge, created, last used (or "never used"), expiry (or "no expiry") via `formatDate`, plus a per-row revoke AlertDialog naming the token.
- Wired the `api-tokens` tab into `settings/page.tsx` (TabsList now `md:grid-cols-6`) and added the muted MCP hint paragraph.
- Added 34 `settings.*` keys to all four locale files with full key parity and no em/en-dashes.

## Task Commits

Each task was committed atomically:

1. **Task 1: ApiTokensCard (list, create, show-once, revoke)** - `b79d8cf` (feat)
2. **Task 2: Settings tab + four-locale i18n keys** - `b1e8019` (feat)

**Plan metadata:** committed with this summary (docs: complete plan)

## Files Created/Modified
- `apps/web/components/ApiTokensCard.tsx` - the token-management card (list, create, show-once, revoke), ~385 lines.
- `apps/web/app/(dashboard)/settings/page.tsx` - imports ApiTokensCard, adds the sixth tab trigger and its TabsContent.
- `apps/web/messages/{en,nl,fr,de}/common.json` - 34 new `settings.*` keys each, same key set across all four.

## Verification Results
- Task 1 automated grep gate: file present, calls `api/v1/api-tokens`, uses `navigator.clipboard`, uses `useTranslations("settings")`, no `localStorage` (observed PASS).
- Task 2 JSON parity + dash script (en/nl/fr/de, all 34 keys present, no U+2014/U+2013): observed PASS.
- `pnpm --filter @rentular/web lint` (`tsc --noEmit`): observed exit 0.
- `apps/api` was not touched; no api files are in the diff, so the api test suite is unchanged from Plan 04.

## Decisions Made
- **Scope defaults to read.** The scope Select starts at `read`; `read+write` must be chosen on purpose with an explicit label, so a token is never accidentally minted with write power (T-11-15).
- **Revoke names the token.** The per-row revoke action opens an AlertDialog whose description interpolates the token name, so an accidental revoke needs a deliberate confirm (T-11-16).
- **Plaintext is show-once and memory-only.** The returned `token` lives solely in the `newToken` state variable, is rendered once in the dialog, and is cleared on close; it is never persisted to localStorage, sessionStorage, the URL or the list (T-11-10).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `tokenScopeWriteShort` wording**
- **Found during:** Task 1
- **Issue:** The plan listed both `tokenScopeWriteShort` (badge) and `tokenScopeWrite` (select item) without prescribing the short badge text. A one-word "Write" badge would misrepresent a write token, which also grants read.
- **Fix:** Set the write badge short label to "Read and write" (and locale equivalents) so the badge is accurate; the read badge stays "Read".
- **Files modified:** the four locale files.
- **Verification:** parity script passes; lint green.
- **Committed in:** b1e8019

No architectural changes. No scope creep.

## Threat Surface
All UI maps to mitigations already in the plan's threat register: T-11-10 (plaintext memory-only, cleared on close), T-11-01 (only `ApiTokenPublic` fields rendered), T-11-15 (scope defaults to read), T-11-16 (naming confirm on revoke). No new network surface: the component only calls the Plan 02 `/api-tokens` router with cookie credentials; CSRF is enforced server-side.

## Known Stubs
None. The card is wired to the live `/api-tokens` endpoints shipped in Plan 02.

## User Setup Required
- None for the UI. End-to-end use in a running environment still needs `API_TOKEN_PEPPER` set and the Plan 07 migration applied (per Plan 02), which is the documented manual VALIDATION step for API-03.

## Assumption Drift (advisory)
None material. The interfaces and primitives matched the plan.

## Self-Check: PASSED

All 6 files are present on disk; both task commits (b79d8cf, b1e8019) exist in git history.

---
*Phase: 11-mcp-server-external-api-access*
*Completed: 2026-10-05*
