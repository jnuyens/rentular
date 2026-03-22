---
phase: 1
slug: security-infrastructure
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-22
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | No test framework in Phase 1 (per research). Verification via grep + pnpm build + manual curl/EXPLAIN |
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
| TBD | 01 | 1 | SEC-01 | integration | `curl -X POST ... -H "Origin: evil.com"` | ❌ W0 | ⬜ pending |
| TBD | 01 | 1 | SEC-02 | build | `pnpm turbo build` (strict TS, no any) | ✅ | ⬜ pending |
| TBD | 01 | 1 | INF-01 | grep | `grep -r "TODO" apps/api/src/routes/` | ✅ | ⬜ pending |
| TBD | 01 | 1 | INF-02 | integration | `curl GET /api/v1/costs` | ❌ W0 | ⬜ pending |
| TBD | 01 | 1 | INF-03 | integration | `curl GET /api/v1/rent-adjustments/free-periods` | ❌ W0 | ⬜ pending |
| TBD | 01 | 1 | INF-04 | integration | `curl GET /api/v1/communications` | ❌ W0 | ⬜ pending |
| TBD | 01 | 1 | INF-05 | SQL | `EXPLAIN SELECT ... FROM payments WHERE leaseId=... AND status=...` | ❌ W0 | ⬜ pending |
| TBD | 01 | 1 | LSE-01 | build | `pnpm turbo build` (lease type enum verified) | ✅ | ⬜ pending |
| TBD | 01 | 1 | LSE-02 | integration | `curl POST /api/v1/maintenance/auto-generate` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Test infrastructure setup if no test framework exists in `apps/api/`
- [ ] DB must be running for integration tests (no in-memory fallback)
- [ ] Redis must be running for health check tests

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| CSRF blocks cross-origin POST | SEC-01 | Requires browser/curl with Origin header | Send POST to any state-changing endpoint with `Origin: https://evil.com`, verify 403 |
| DB indexes used by query planner | INF-05 | Requires running MySQL EXPLAIN | Run EXPLAIN on payment/property queries, verify `key` column shows index name |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
