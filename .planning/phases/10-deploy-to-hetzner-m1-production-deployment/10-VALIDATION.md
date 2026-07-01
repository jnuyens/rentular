---
phase: 10
slug: deploy-to-hetzner-m1-production-deployment
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-01
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> **Nature of this phase:** infrastructure/deployment. Most validation is HTTP-observable smoke checks against the running stack, plus a few unit assertions for the two folded code fixes. The existing vitest suite is the regression guard for code changes.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (api) for code fixes; shell/curl smoke checks for deploy artifacts |
| **Config file** | `apps/api/vitest.config.ts` (existing) |
| **Quick run command** | `pnpm --filter @rentular/api test --run` |
| **Full suite command** | `pnpm build && pnpm --filter @rentular/api test --run` |
| **Estimated runtime** | ~60–120s (build dominates) |

---

## Sampling Rate

- **After every task commit:** Run the task's `<automated>` check (unit test, `docker build`, `docker compose config`, or `hadolint`/config-lint as applicable)
- **After every plan wave:** Run `pnpm build` + api vitest suite
- **Before `/gsd:verify-work`:** Full build green + smoke checks pass against the deployed box
- **Max feedback latency:** ~120 seconds (local); deploy smoke checks run post-deploy on m1

---

## Per-Task Verification Map

| Task area | Wave | Secure Behavior | Test Type | Automated Command | Status |
|-----------|------|-----------------|-----------|-------------------|--------|
| Stripe boot-guard (D-09) | 1 | API boots with `STRIPE_SECRET_KEY` unset; no top-level `new Stripe()` crash | unit | `pnpm --filter @rentular/api test --run` (add stripe-guard test) | ⬜ pending |
| Env-loading confirm (D-10) | 1 | No `dotenv` import; config read from `process.env` only | source assert | `! grep -rq "dotenv" apps/api/src` | ⬜ pending |
| next.config standalone | 1 | `output: 'standalone'` + `outputFileTracingRoot` set | source assert | `grep -q "standalone" apps/web/next.config.ts` | ⬜ pending |
| API Dockerfile builds | 2 | Multi-stage build produces runnable `node dist/index.js` image | build | `docker build -f apps/api/Dockerfile .` | ⬜ pending |
| Web Dockerfile builds | 2 | Standalone image; `NEXT_PUBLIC_API_URL` passed as build ARG (not runtime) | build | `docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=... .` | ⬜ pending |
| compose valid + prod-hardened | 2 | web/api/db bound to 127.0.0.1; `env_file:` wired; no default DB passwords | config | `docker compose -f docker-compose.prod.yml config` | ⬜ pending |
| `pnpm bootstrap` idempotent | 3 | drizzle push + owner create; re-run is a no-op | integration | run twice, second exits 0 with owner-exists | ⬜ pending |
| deploy.sh gates on build not lint | 3 | script runs `pnpm build`, never `pnpm lint` | source assert | `grep -q "pnpm build" deploy.sh && ! grep -q "pnpm lint" deploy.sh` | ⬜ pending |
| webhook HMAC-verified | 3 | receiver rejects unsigned/invalid-signature payloads | unit/integration | signature-mismatch returns non-2xx | ⬜ pending |

---

## Wave 0 Requirements

- [ ] `apps/api/src/routes/__tests__/stripe.test.ts` (or lib test) — asserts API module import does not throw when `STRIPE_SECRET_KEY` unset
- [ ] No new test framework needed — vitest already present

---

## Manual-Only Verifications

> These require the deployed box (m1) and are the smoke signals that prove the goal. They map to the deferred `09-HUMAN-UAT.md` prod verification.

| Behavior | Why Manual | Test Instructions |
|----------|------------|-------------------|
| `https://rentular.com` reachable, valid TLS | Needs DNS + LE cert on m1 | `curl -sSI https://rentular.com` → 200; `echo | openssl s_client -connect rentular.com:443` → cert dates valid |
| API health through nginx | Needs running stack | `curl -s https://rentular.com/api/v1/... ` health path (API exposes `app.get("/health")` at api root → confirm nginx path mapping) returns `{"status":"healthy"...}` |
| No `localhost:4000` in served HTML | Build-ARG correctness for `NEXT_PUBLIC_API_URL` | `curl -s https://rentular.com | grep -c "localhost:4000"` → 0 |
| Container healthchecks green | Compose orchestration | `docker compose ps` → all `healthy` |
| Ponto sandbox bank-connection E2E | Live provider round-trip | run `09-HUMAN-UAT.md` items against prod |

---

## Validation Sign-Off

- [ ] All code-change tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Deploy-artifact tasks have a build/config/source-assert `<automated>` check
- [ ] Smoke checks documented for post-deploy manual verification
- [ ] No watch-mode flags
- [ ] `nyquist_compliant: true` set after planner aligns per-task verifies

**Approval:** pending
