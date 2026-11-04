---
phase: 12
slug: billing-and-plan-limits-aligned-with-the-public-pricing
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-11-04
---

# Phase 12: Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: `12-RESEARCH.md` section "Validation Architecture".

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.2 (API only; apps/web has no test runner, typecheck only) |
| **Config file** | `apps/api/vitest.config.ts` |
| **Quick run command** | `cd apps/api && npx vitest run <changed test file>` |
| **Full suite command** | `pnpm --filter @rentular/api test && pnpm lint` (also `TZ=UTC` run of the api suite) |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** run the task's specific test file(s)
- **After every plan wave:** full suite command
- **Before `/bm:verify-work`:** full suite green, then prod UAT in Stripe test mode
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

Filled in by the planner per task (each task's `<verify>` block). Requirement to test mapping:

| Requirement | Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|----------|-----------|-------------------|-------------|--------|
| BILL-06 | billing disabled without key or price ids; exempt bypasses all gates | unit | `npx vitest run src/lib/__tests__/billing.test.ts` | W0 | pending |
| BILL-01 | checkout uses stored customer and server price ids, session-only; webhook signature, dedupe, subscription upsert | route | `npx vitest run src/routes/__tests__/billing.test.ts src/routes/__tests__/stripeWebhook.test.ts` | W0 | pending |
| BILL-01 | old plan names gone | unit | `npx vitest run src/__tests__/noLegacyPlans.test.ts` | W0 | pending |
| BILL-02 | 4th property blocked (402 PROPERTY_LIMIT) on free; import respects slots | route/unit | `npx vitest run src/routes/__tests__/propertiesLimit.test.ts src/services/__tests__/importPlanLimit.test.ts` | W0 | pending |
| BILL-03 | SMS allowance (plan, 50/month, Brussels month), queueSms gate, WhatsApp then email fallback | unit | `npx vitest run src/lib/__tests__/billing.test.ts src/jobs/__tests__/smsGate.test.ts src/services/__tests__/reminderChannel.test.ts src/services/__tests__/paymentFollowUp.test.ts` | W0 / extend | pending |
| BILL-04 | bank tracking quantity sync, 402 with checkout URL without subscription | unit/route | `npx vitest run src/lib/__tests__/bankTrackingSync.test.ts src/routes/__tests__/bankConnections.test.ts` | W0 / extend | pending |
| BILL-05 | legal and pricing strings present in 4 locales, mention 5 euro excl. VAT, no dashes | unit | `npx vitest run src/__tests__/i18n-completeness.test.ts` | extend | pending |
| All | type safety api + web | static | `pnpm lint` | yes | pending |

---

## Wave 0 Requirements

- [ ] `apps/api/src/lib/__tests__/billing.test.ts`
- [ ] `apps/api/src/lib/__tests__/bankTrackingSync.test.ts`
- [ ] `apps/api/src/routes/__tests__/billing.test.ts`
- [ ] `apps/api/src/routes/__tests__/stripeWebhook.test.ts`
- [ ] `apps/api/src/routes/__tests__/propertiesLimit.test.ts`
- [ ] `apps/api/src/services/__tests__/importPlanLimit.test.ts`
- [ ] `apps/api/src/jobs/__tests__/smsGate.test.ts`
- [ ] shared Stripe mock helper (`apps/api/src/__tests__/helpers/stripeMock.ts`)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Stripe key validity (mk_ prefix) | BILL-01 | Needs the owner's Stripe dashboard | Owner checks the m1 key in the dashboard before anything is created in Stripe |
| Real checkout, portal cancel at period end, bank quantity on upcoming invoice, 21% VAT line | BILL-01, BILL-04 | Real Stripe | Prod UAT in Stripe test mode with a non-exempt test account |
| Final legal wording | BILL-05 | Owner approval | Owner approves EN/NL/FR/DE text before deploy |

---

## Validation Sign-Off

- [x] All tasks have automated verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planned 2026-11-04 (wave_0_complete flips after the Wave 0 test files exist)
