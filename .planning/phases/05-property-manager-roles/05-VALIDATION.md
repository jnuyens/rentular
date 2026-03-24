---
phase: 5
slug: property-manager-roles
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-24
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None detected — no test infrastructure in the project |
| **Config file** | none |
| **Quick run command** | N/A |
| **Full suite command** | N/A |
| **Estimated runtime** | N/A |

---

## Sampling Rate

- **After every task commit:** Manual verification via API calls (curl/Postman)
- **After every plan wave:** Manual end-to-end flow test
- **Before `/gsd:verify-work`:** Full manual UAT checklist
- **Max feedback latency:** N/A (manual)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 05-01-XX | 01 | 1 | PM-01 | manual-only | Manual: create invitation via API, verify email received | N/A | ⬜ pending |
| 05-01-XX | 01 | 1 | PM-02 | manual-only | Manual: click invitation link, verify access granted | N/A | ⬜ pending |
| 05-XX-XX | XX | X | PM-03 | manual-only | Manual: log in as manager, verify property list | N/A | ⬜ pending |
| 05-XX-XX | XX | X | PM-04 | manual-only | Manual: try unauthorized actions as each role | N/A | ⬜ pending |
| 05-XX-XX | XX | X | PM-05 | manual-only | Manual: revoke via API, verify access removed | N/A | ⬜ pending |
| 05-XX-XX | XX | X | PM-06 | manual-only | Manual: change role via API, verify permissions update | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers no automated testing. No test framework is configured in this project. Setting up a test framework is out of scope for this phase (Phases 1-4 completed without tests).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Owner invites manager by email | PM-01 | No test framework configured | Create invitation via API, verify email received in Mailpit |
| Manager receives and accepts invitation | PM-02 | No test framework configured | Click invitation link, verify access granted and dashboard shows assigned properties |
| Manager sees only assigned properties | PM-03 | No test framework configured | Log in as manager, verify property list shows only assigned properties |
| Permissions enforced on all endpoints | PM-04 | No test framework configured | Try unauthorized actions as each role (viewer write, accountant billing, etc.) |
| Owner revokes access | PM-05 | No test framework configured | Revoke via API, verify access removed immediately |
| Owner changes role | PM-06 | No test framework configured | Change role via API, verify new permissions take effect immediately |

---

## Validation Sign-Off

- [ ] All tasks have manual verification instructions
- [ ] Sampling continuity: manual check after each task commit
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency: manual (accepted)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
