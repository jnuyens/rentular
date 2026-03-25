---
phase: 6
slug: smovin-import-beta
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-25
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None — no test infrastructure exists in this project |
| **Config file** | none — no automated tests for scraping phase |
| **Quick run command** | N/A |
| **Full suite command** | N/A |
| **Estimated runtime** | N/A (manual verification) |

---

## Sampling Rate

- **After every task commit:** Manual verification against development Smovin account
- **After every plan wave:** Full end-to-end import test with real Smovin account
- **Before `/gsd:verify-work`:** Successful import of at least one property with tenant and lease data
- **Max feedback latency:** N/A (manual)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | IMP-01 | manual-only | Manual: submit form, check DB row has encrypted fields | N/A | ⬜ pending |
| 06-01-02 | 01 | 1 | IMP-02 | manual-only | Manual: run spike test against real Smovin account | N/A | ⬜ pending |
| 06-02-01 | 02 | 1 | IMP-03 | manual-only | Manual: verify imported properties/tenants/leases match Smovin data | N/A | ⬜ pending |
| 06-02-02 | 02 | 1 | IMP-04 | manual-only | Manual: observe UI during import | N/A | ⬜ pending |
| 06-02-03 | 02 | 1 | IMP-05 | manual-only | Manual: check DB after successful import, credential columns should be NULL | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements — no test framework setup needed.*

**Justification:** This phase is entirely dependent on scraping a third-party website (Smovin). Automated tests cannot authenticate against Smovin without real credentials, and mocking the entire Smovin DOM would provide false confidence. The spike test IS the validation.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Credential submission and encryption | IMP-01 | Requires real Smovin account | Submit credentials via form, verify DB row has non-null encrypted fields |
| Smovin scraping | IMP-02 | Requires live Smovin session | Run discovery job, verify properties discovered |
| Data mapping and import | IMP-03 | Requires real Smovin data | Compare imported Rentular data against Smovin account |
| Real-time progress display | IMP-04 | Visual/UX verification | Observe progress bar and log messages during import |
| Credential cleanup | IMP-05 | Requires completed import session | After successful import, verify credential columns are NULL in DB |

---

## Validation Sign-Off

- [ ] All tasks have manual verification or Wave 0 dependencies
- [ ] Sampling continuity: manual verification after each task commit
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < N/A (manual)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
