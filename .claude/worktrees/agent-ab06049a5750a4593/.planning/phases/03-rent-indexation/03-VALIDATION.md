---
phase: 3
slug: rent-indexation
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-22
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | No test framework (per Phase 1/2 precedent). Verification via grep + pnpm build + manual checks |
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
| TBD | 01 | 1 | IDX-01 | build + grep | `pnpm turbo build` + grep for Statbel fetch | ❌ W0 | ⬜ pending |
| TBD | 02 | 2 | IDX-02, IDX-03 | build + grep | `pnpm turbo build` + grep for calculateIndexedRent | ❌ W0 | ⬜ pending |
| TBD | 02 | 2 | IDX-04, IDX-05 | build + grep | grep for preview/apply endpoints | ❌ W0 | ⬜ pending |
| TBD | 02 | 2 | IDX-06, IDX-07 | build + grep | grep for indexationRecords insert | ❌ W0 | ⬜ pending |
| TBD | 02 | 2 | IDX-08 | build + grep | grep for queueEmail in apply | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements — no test framework needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Statbel API returns valid health index data | IDX-01 | Requires live API call | Run health index fetch job, verify healthIndexValues table populated |
| Indexation calculation correct for each region | IDX-02, IDX-03 | Requires real index data + lease | Preview indexation for lease in each region, verify formula matches |
| Tenant receives email in preferred language | IDX-08 | Requires SMTP delivery | Apply indexation, verify email received with correct language |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
