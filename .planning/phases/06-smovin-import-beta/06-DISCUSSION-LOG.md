# Phase 6: Smovin Import (Beta) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-25
**Phase:** 06-smovin-import-beta
**Areas discussed:** Scraping strategy, Credential handling, Data mapping & conflicts, Import scope & progress UX

---

## Scraping Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Headless browser (Playwright) | Automates real browser, most complete extraction, Cloudflare risk | ✓ |
| User-assisted browser extension | Runs in user's real session, bypasses Cloudflare, high friction | |
| Manual CSV/spreadsheet upload | User exports data manually, zero scraping risk, high user effort | |
| Hybrid: Playwright + CSV fallback | Try scraping first, fall back to CSV if blocked | |

**User's choice:** Playwright-first with early spike test. No pre-built fallback.
**Notes:** User asked about rate limiting (not effective against Cloudflare fingerprinting) and about the browser extension approach. After hearing the extension downsides (install friction, Chrome Web Store review, trust barrier for Belgian landlords), locked Playwright with spike test. Explicit instruction: "prepare for failure" — spike test is a hard gate.

---

## Credential Handling

| Option | Description | Selected |
|--------|-------------|----------|
| In-memory only | Held in memory during session, re-enter on retry | |
| Encrypted short-lived token | Stored in Redis with TTL | |
| User stays on page | Credentials never leave browser, WebSocket session | |
| Persist to database | Encrypted in DB, deleted after successful import | ✓ |

**User's choice:** Persist encrypted credentials to database, remove after successful import.
**Notes:** User explicitly chose database persistence over the presented options, overriding the requirement's "never stored in database" language. This allows retries without re-entering credentials.

---

## Data Mapping & Conflicts

| Option | Description | Selected |
|--------|-------------|----------|
| Skip duplicates | Match on address/email, skip silently if exists | ✓ |
| Overwrite with Smovin data | Smovin data wins, could destroy manual edits | |
| Prompt per conflict | Show diff for each, user chooses | |
| Import as new | Always create new records, user deduplicates later | |

**User's choice:** Skip duplicates
**Notes:** Quick decision, no follow-up needed.

---

## Import Scope

| Option | Description | Selected |
|--------|-------------|----------|
| All-or-nothing | Import everything from Smovin | |
| Selective | Scrape all, show list, user picks what to import | ✓ |

**User's choice:** Selective import

---

## Progress UX

| Option | Description | Selected |
|--------|-------------|----------|
| Real-time log on page | Live updates via polling/SSE, user stays on page | ✓ |
| Background job with notification | User can leave, gets email when done | |
| Progress bar with summary | Simple bar during import, detailed summary at end | |

**User's choice:** Real-time log on page with progress bar (combined)

---

## Claude's Discretion

- Polling vs SSE for progress updates
- Encryption algorithm for credentials
- Smovin DOM selector strategy
- Single vs dual BullMQ job architecture

## Deferred Ideas

None
