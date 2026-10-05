---
phase: 11
slug: mcp-server-external-api-access
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-10-04
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | apps/api/ (vitest, `test: "vitest run"`) |
| **Quick run command** | `pnpm --filter @rentular/api test` |
| **Full suite command** | `pnpm --filter @rentular/api test` |
| **Estimated runtime** | ~20 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter @rentular/api test`
- **After every plan wave:** Run `pnpm --filter @rentular/api test`
- **Before `/bm:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 11-01-xx | 01 | 1 | API-01 | T-11-01 | Minted token stored only as SHA-256 hash; plaintext never persisted | unit | `pnpm --filter @rentular/api test apiTokens` | ❌ W0 | ⬜ pending |
| 11-02-xx | 02 | 2 | API-02 | T-11-02 | `Bearer rtl_…` resolves to same userId as cookie; expired/revoked rejected (401); CSRF exempts Bearer | unit | `pnpm --filter @rentular/api test authMiddleware` | ❌ W0 | ⬜ pending |
| 11-02-xx | 02 | 2 | API-02 | T-11-03 | PAT request still passes `getAccessiblePropertyIds` scope + role checks (cross-landlord denied) | unit | `pnpm --filter @rentular/api test tokenScope` | ❌ W0 | ⬜ pending |
| 11-03-xx | 03 | 2 | MCP-03 | T-11-04 | record-payment + send-reminder hardened to manager+ (viewer → 403) | unit | `pnpm --filter @rentular/api test writeGuards` | ❌ W0 | ⬜ pending |
| 11-03-03 | 03 | 2 | MCP-03 | T-11-22 | send-reminder honors `tenants.preferred_channel`: sms → queueSms, whatsapp → sendWhatsApp, email or unavailable channel → email; channel used recorded in payment_reminders | unit | `pnpm --filter @rentular/api test reminderChannel manualReminder` | ❌ W0 | ⬜ pending |
| 11-04-xx | 04 | 3 | MCP-01/02/03 | T-11-05 | MCP tools scope to accessible properties; write tools require manager+; calls logged | unit | `pnpm --filter @rentular/api test mcpTools` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*Exact task IDs are assigned by the planner; rows above are the required coverage shape.*

---

## Wave 0 Requirements

- [ ] `apps/api/src/**/apiTokens*.test.ts` — token mint/hash/verify/revoke/expiry stubs (API-01)
- [ ] `apps/api/src/**/authMiddleware*.test.ts` — Bearer accept/reject + CSRF-exempt stubs (API-02)
- [ ] token-scope test — PAT request is still property/role scoped (API-02)
- [ ] write-guard test — manager+ enforcement on record-payment + send-reminder (MCP-03)
- [ ] `apps/api/src/services/__tests__/reminderChannel.test.ts` + `manualReminder.test.ts`: preferred-channel dispatch with email fallback, channel recorded (MCP-03, T-11-22)
- [ ] MCP tool test harness — tools call the API with a PAT and stay scoped (MCP-01/02/03)

*Existing vitest infrastructure covers framework install; only new test files are needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Settings UI: create token, see it once, copy, revoke | API-03 | Browser interaction; "show once" cannot be asserted after reload | In prod Settings, create a token, confirm the plaintext shows once and not after refresh, then revoke and confirm it stops working |
| Claude connects to the stdio MCP server and lists tools | MCP-01 | Requires an external MCP client (Claude Desktop/Code) with the PAT in env | Configure the server in a client, confirm read tools return the landlord's own properties and a write tool is refused for a viewer-scoped token |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-10-05
