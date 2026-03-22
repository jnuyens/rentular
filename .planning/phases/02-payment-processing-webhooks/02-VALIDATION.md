---
phase: 2
slug: payment-processing-webhooks
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-22
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | No test framework in Phase 2 (per Phase 1 precedent). Verification via grep + pnpm build + manual curl/DB checks |
| **Config file** | none |
| **Quick run command** | `pnpm turbo build` |
| **Full suite command** | `pnpm turbo build` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm turbo build`
- **After every plan wave:** Run `pnpm turbo build`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| TBD | 01 | 1 | PAY-07, PAY-08 | build + grep | `pnpm turbo build` + grep for webhook_events table | ❌ W0 | ⬜ pending |
| TBD | 01 | 1 | PAY-09 | build + grep | grep for event ID unique constraint | ❌ W0 | ⬜ pending |
| TBD | 02 | 1 | PAY-01, PAY-02 | build + grep | `pnpm turbo build` + grep for payment CRUD | ❌ W0 | ⬜ pending |
| TBD | 02 | 1 | PAY-03 | build + grep | grep for manual payment recording | ❌ W0 | ⬜ pending |
| TBD | 02 | 1 | PAY-04 | build + grep | grep for createPayment call | ❌ W0 | ⬜ pending |
| TBD | 02 | 1 | PAY-05, PAY-06 | build + grep | grep for retryPayment/cancelPayment calls | ❌ W0 | ⬜ pending |
| TBD | 03 | 2 | PAY-10 | build + grep | grep for overview endpoint | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements — no test framework needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| GoCardless payment collection creates processing payment | PAY-04 | Requires GoCardless sandbox API call | Trigger collection via API, verify payment appears with status=processing |
| Webhook updates payment status | PAY-07 | Requires GoCardless webhook delivery | Send test webhook via GoCardless dashboard, verify DB state change |
| Duplicate webhook is safely skipped | PAY-09 | Requires sending same webhook twice | Send identical webhook, verify no duplicate records |
| Bank monitoring matches incoming transfer | D-03/D-05 | Requires PSD2 bank connection | Connect test bank, send transfer with structured communication, verify auto-match |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
