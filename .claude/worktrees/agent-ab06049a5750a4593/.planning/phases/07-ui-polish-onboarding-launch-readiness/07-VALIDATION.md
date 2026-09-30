---
phase: 7
slug: ui-polish-onboarding-launch-readiness
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-28
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (if present) / jest 29.x / manual verification |
| **Config file** | TBD — Wave 0 installs if needed |
| **Quick run command** | `pnpm test` |
| **Full suite command** | `pnpm test --run` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test`
- **After every plan wave:** Run `pnpm test --run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 1 | UI-01, UI-02 | visual/manual | Manual browser check | N/A | ⬜ pending |
| 07-02-01 | 02 | 1 | UI-03 | visual/manual | Manual responsive check | N/A | ⬜ pending |
| 07-03-01 | 03 | 2 | UI-04, UI-05 | visual/manual | Manual consistency check | N/A | ⬜ pending |
| 07-04-01 | 04 | 2 | ONB-01, ONB-02, ONB-03 | integration | Manual wizard walkthrough | N/A | ⬜ pending |
| 07-05-01 | 05 | 3 | I18N-01 | automated | `grep -c` key count comparison | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Test framework setup (vitest or jest) if not already configured
- [ ] Shared test fixtures for component rendering

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Logo size/position on dashboard | UI-01 | Visual layout verification | Open dashboard, verify logo is larger and positioned top-left |
| Landing page branding alignment | UI-02 | Visual alignment check | Open landing page, verify branding/watermark alignment |
| Mobile responsive sidebar | UI-03 | Touch interaction + viewport | Open on mobile/DevTools 375px, verify hamburger drawer works |
| Landing page visual refresh | UI-04 | Full page visual review | Open landing page, verify marketing sections render correctly |
| Consistent styling across pages | UI-05 | Cross-page visual consistency | Navigate all dashboard pages, verify spacing/fonts/colors match |
| Onboarding wizard flow | ONB-01 | Multi-step user flow | Register new user, verify wizard appears and all 4 steps work |
| Onboarding resume | ONB-02 | State persistence | Leave wizard mid-step, re-login, verify resume at correct step |
| Onboarding skip | ONB-03 | User flow branch | Click "Skip setup", verify redirect to dashboard |
| Translation completeness | I18N-01 | Key count verification | Compare key counts across en.json, nl.json, fr.json, de.json |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
