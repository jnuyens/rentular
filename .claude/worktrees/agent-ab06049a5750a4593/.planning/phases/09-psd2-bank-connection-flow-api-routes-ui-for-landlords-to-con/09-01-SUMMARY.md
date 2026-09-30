---
phase: 09-psd2-bank-connection-flow-api-routes-ui-for-landlords-to-con
plan: 01
subsystem: bank-connections
tags: [drizzle, schema, psd2, ponto, vitest, encryption]
requires:
  - existing bank_connections table from Phase 2
  - existing payments table (FK target for matchedPaymentId)
  - apps/api/src/lib/encryption.ts AES-256-GCM helper (consumer Plan 02)
provides:
  - bank_statements drizzle table (22 cols, 3 indexes)
  - 8 additive token/metadata columns on bank_connections
  - Ponto sandbox fixture corpus for Plans 02/03 tests
  - MSW v2 dev-dep for HTTP mocking
affects:
  - packages/db barrel: '@rentular/db' now re-exports bankStatements
tech-stack:
  added:
    - msw@^2.6.0 (devDependency in @rentular/api)
  patterns:
    - "AES-256-GCM ciphertext stored as { encrypted, iv, tag } triplet per secret column"
    - "uniqueIndex on (connection_id, external_transaction_id) as dedup safety net"
    - "mysqlEnum match_status for normalized matcher outcome"
key-files:
  created:
    - packages/db/src/schema/bankStatements.ts
    - apps/api/src/__tests__/bankStatementsSchema.test.ts
    - apps/api/test/fixtures/ponto/oauth-token-success.json
    - apps/api/test/fixtures/ponto/accounts-list.json
    - apps/api/test/fixtures/ponto/transactions-list.json
    - apps/api/test/fixtures/ponto/institutions-be.json
  modified:
    - packages/db/src/schema/bankConnections.ts
    - packages/db/src/schema/index.ts
    - apps/api/package.json
    - pnpm-lock.yaml
decisions:
  - "Encrypted PII columns stored as text + 64-char varchar IV + 64-char varchar auth_tag triplet (matches encryption.ts return shape)"
  - "amount decimal(12, 2) (vs payments' decimal(10, 2)) — bank statements include historical/large sums beyond rent range"
  - "country varchar(2) NOT NULL DEFAULT 'BE' — country defaults are stable so a NOT NULL with default is safer than nullable"
  - "Match status enum 'mismatched_amount' (underscore) — matches mysql enum naming convention"
  - "drizzle-kit push deferred to post-merge — worktree environment has no local MySQL/docker; orchestrator/CI re-runs push against real DB"
metrics:
  duration_seconds: 496
  duration_pretty: "8m 16s"
  tasks_completed: 3
  files_created: 6
  files_modified: 4
  completed_at: "2026-05-11T22:50:37Z"
---

# Phase 09 Plan 01: Database Scaffolding + Test Fixtures Summary

**One-liner:** Adds additive token-encryption + provider-metadata columns to `bank_connections`, creates the audit `bank_statements` table with encrypted-PII triplet columns, lands four Ponto sandbox JSON fixtures, and installs MSW v2 for Plans 02/03 HTTP mocking.

---

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Extend bank_connections schema with token encryption + provider metadata columns | `f4beb85` | `packages/db/src/schema/bankConnections.ts` |
| 2 (RED) | Add failing schema-shape test | `bd95b51` | `apps/api/src/__tests__/bankStatementsSchema.test.ts` |
| 2 (GREEN) | Add bank_statements drizzle schema + barrel re-export | `4ee5dad` | `packages/db/src/schema/bankStatements.ts`, `packages/db/src/schema/index.ts` |
| 3 | Install MSW + record Ponto sandbox fixtures | `4560433` | `apps/api/package.json`, `pnpm-lock.yaml`, `apps/api/test/fixtures/ponto/*.json` |

---

## Columns Added to `bank_connections`

All eight additive columns are nullable except `country` (NOT NULL DEFAULT `'BE'`). No existing column or index altered.

| Column | Type | Purpose |
| --- | --- | --- |
| `encrypted_access_token` | `text` | AES-256-GCM ciphertext of Ponto OAuth access token |
| `token_iv` | `varchar(64)` | base64 IV for access-token ciphertext |
| `token_auth_tag` | `varchar(64)` | base64 GCM auth tag for access-token ciphertext |
| `encrypted_refresh_token` | `text` | AES-256-GCM ciphertext of Ponto OAuth refresh token |
| `refresh_token_iv` | `varchar(64)` | base64 IV for refresh-token ciphertext |
| `refresh_token_auth_tag` | `varchar(64)` | base64 GCM auth tag for refresh-token ciphertext |
| `provider_metadata` | `json` | Ponto-specific fields (`organisation_id`, `integration_id`, `account_ids[]`) |
| `country` | `varchar(2)` NOT NULL DEFAULT `'BE'` | ISO-3166 alpha-2; defaults to BE for current market |

Existing index set unchanged: `bank_connections_owner_idx`, `bank_connections_status_idx`.

---

## New `bank_statements` Table

**Purpose:** provider-agnostic audit table of every raw bank transaction line fetched from a connected bank, with encrypted PII at rest and dedup safety on the provider transaction id.

**22 columns + 3 indexes:**

- Identity: `id` PK varchar(36), `connection_id` FK → `bank_connections.id`, `external_transaction_id` (provider UUID).
- Money: `amount decimal(12, 2)` NOT NULL, `currency varchar(3)` NOT NULL DEFAULT `'EUR'`.
- Dates: `booking_date date` NOT NULL (matches `IncomingTransaction.bookingDate`), `value_date date` nullable.
- Encrypted PII (3 cols each): counterparty name + counterparty IBAN — `*_encrypted text` + `*_iv varchar(64)` + `*_auth_tag varchar(64)`.
- Communication: `structured_communication varchar(50)` (digits-only normalized to match `transactionMatcher.ts`), `unstructured_communication text`.
- Encrypted raw audit payload (NOT NULL): `raw_payload_encrypted text`, `raw_payload_iv varchar(64)`, `raw_payload_auth_tag varchar(64)`.
- Match result: `matched_payment_id varchar(36)` FK → `payments.id` nullable, `match_status mysqlEnum("unmatched","matched","mismatched_amount","ignored")` NOT NULL DEFAULT `'unmatched'`.
- Audit timestamps: `imported_at timestamp` NOT NULL DEFAULT `now()`, `matched_at timestamp` nullable.

**Indexes:**

| Name | Type | Columns | Reason |
| --- | --- | --- | --- |
| `bank_statements_conn_tx_uniq` | UNIQUE | `(connection_id, external_transaction_id)` | Dedup safety net — duplicate provider replay returns MySQL 1062 (importer no-ops) |
| `bank_statements_conn_date_idx` | INDEX | `(connection_id, booking_date)` | Time-range queries scoped to connection |
| `bank_statements_match_status_idx` | INDEX | `(match_status)` | Filter unmatched/mismatched rows in admin views |

---

## Test Fixtures

Four Ponto sandbox JSON files committed at `apps/api/test/fixtures/ponto/`:

| File | Endpoint | Notes |
| --- | --- | --- |
| `oauth-token-success.json` | `POST /ponto-connect/oauth2/token` | authorization_code grant response (access + refresh tokens, expires_in=1799) |
| `accounts-list.json` | `GET /ponto-connect/accounts` | Single BE71… fixture account (documentation-reserved IBAN range) |
| `transactions-list.json` | `GET /ponto-connect/accounts/:id/transactions` | One structured (rent +++001/2345/67890+++) + one unstructured (Spotify subscription) transaction |
| `institutions-be.json` | `GET /ponto-connect/financial-institutions?filter[country]=BE` | Top 6 BE banks: Belfius, KBC, BNP Paribas Fortis, ING Belgium, Argenta, Crelan |

All values obviously fictitious — mitigates threat T-09-01-04 (fixture tampering / accidental real-data leak).

All four files parse as valid JSON (verified via `node -e "JSON.parse(...)"` on each).

---

## MSW Installation

```
apps/api/package.json devDependencies:
  "msw": "^2.6.0"
```

Vitest config (`apps/api/vitest.config.ts`) already covers `src/**/__tests__/**/*.test.ts` — no config change needed for Plan 09 test files.

---

## drizzle-kit push Result

**Status: DEFERRED to post-merge.** The parallel worktree this plan ran in has no local MySQL / docker / `.env` (Claude Code parallel agents do not get external services). The `db:push` attempt confirmed the schema is well-formed (drizzle-kit parsed the schema files successfully) and produced `ECONNREFUSED` on the MySQL connect — i.e., a pure environment gate, not a schema-shape problem.

**Post-merge action required (orchestrator / user / CI):**

```bash
pnpm --filter @rentular/db db:push
```

This is also the explicit final-gate step in `09-VALIDATION.md` row `09-05-04` (`pnpm lint && pnpm build && pnpm --filter @rentular/api test --run && pnpm --filter @rentular/db db:push`), so the push is reasserted as part of the Phase 9 close-out checklist.

The push is **idempotent and additive**: it must only `ADD COLUMN` (×8) on `bank_connections` and `CREATE TABLE bank_statements` — no destructive operations. Threat T-09-01-05 mitigation: acceptance criterion in 09-VALIDATION.md row 09-05-04 re-verifies that re-running push reports no changes.

---

## Verification Results

| Check | Status | Detail |
| --- | --- | --- |
| `grep` token-column count on `bankConnections.ts` returns 8 | PASS | 8 |
| `grep` `json` import + column count returns ≥ 2 | PASS | 2 |
| Existing `consentExpiresAt\|lastSyncAt\|errorMessage` preserved | PASS | 3 |
| Index count on `bank_connections` still 2 | PASS | 2 |
| `bank_statements` file exists | PASS | yes |
| `export const bankStatements` count = 1 | PASS | 1 |
| `bank_statements_conn_tx_uniq` declared exactly once | PASS | 1 |
| `match_status` referenced (≥ 1) | PASS | 2 (enum literal + column name) |
| Barrel re-export added | PASS | 1 |
| `pnpm --filter @rentular/api test -- src/__tests__/bankStatementsSchema.test.ts --run` | PASS | 2 passed |
| All 4 Ponto fixture JSON files parse | PASS | all 4 valid |
| `"msw"` listed in api/package.json | PASS | `^2.6.0` |
| `pnpm --filter @rentular/db db:push` | DEFERRED | no local MySQL — re-run post-merge per 09-VALIDATION.md row 09-05-04 |

---

## TDD Gate Compliance

Plan 01 contains one TDD task (Task 2). All three gate commits are present:

1. **RED** `bd95b51` — `test(09-01): add failing schema-shape test ...` — confirmed failing prior to implementation (`Cannot convert undefined or null to object` on `Object.keys(bankStatements)`).
2. **GREEN** `4ee5dad` — `feat(09-01): add bank_statements drizzle schema + barrel re-export` — both test suites pass (`2 passed`).
3. **REFACTOR** — none needed; schema follows existing `communications.ts` / `payments.ts` patterns exactly.

---

## Deviations from Plan

### Auto-fixed / Adapted

**1. [Rule 3 - Blocking environment] `pnpm install` was missing**

- **Found during:** Task 1 lint verification
- **Issue:** Worktree was spawned without `node_modules` populated; `pnpm --filter @rentular/api lint` failed with `sh: tsc: command not found`.
- **Fix:** Ran `pnpm install` at the worktree root (idempotent — only added packages already in the lockfile).
- **Files modified:** none in repo (only `node_modules/`).
- **Commit:** n/a (build-tool side effect).

**2. [Environment gate] `drizzle-kit push` deferred to post-merge**

- **Found during:** Task 3
- **Issue:** Worktree has no local MySQL / docker / `.env`; `db:push` returned `ECONNREFUSED`.
- **Resolution:** Documented as known constraint here. The schema is well-formed and parses; the push step is asserted in the final phase gate `09-05-04` and runs against the real database post-merge.
- **Files modified:** none (only documentation).
- **Commit:** n/a.

### Scope-bound non-actions

Pre-existing `tsc --noEmit` errors in unrelated files (`importDiscoveryWorker.ts`, `importWriteWorker.ts`, `rentAdjustments.ts`, `webhooks.ts`, `paymentStateMachine.ts`, `smovinScraper.ts`, `transactionMatcher.ts`) were NOT addressed — they are out-of-scope per the executor's scope boundary rule (only auto-fix issues directly caused by current task's changes). `bankConnections.ts`, `bankStatements.ts`, and `schema/index.ts` compile cleanly on their own.

---

## Authentication Gates

None.

---

## Known Stubs

None. All schema columns are wired into the test (which passes) and will be consumed by Plans 02/03.

---

## Threat Flags

No new security-relevant surface introduced beyond what the plan's `<threat_model>` already enumerates. Encryption columns + UNIQUE dedup constraint + match_status enum are all covered by T-09-01-01 / T-09-01-02 / T-09-01-03.

---

## Self-Check: PASSED

- `packages/db/src/schema/bankConnections.ts` — FOUND
- `packages/db/src/schema/bankStatements.ts` — FOUND
- `packages/db/src/schema/index.ts` — FOUND (re-export added)
- `apps/api/src/__tests__/bankStatementsSchema.test.ts` — FOUND
- `apps/api/test/fixtures/ponto/oauth-token-success.json` — FOUND
- `apps/api/test/fixtures/ponto/accounts-list.json` — FOUND
- `apps/api/test/fixtures/ponto/transactions-list.json` — FOUND
- `apps/api/test/fixtures/ponto/institutions-be.json` — FOUND
- `apps/api/package.json` — FOUND (msw entry)
- Commits `f4beb85`, `bd95b51`, `4ee5dad`, `4560433` — all FOUND in `git log`.
