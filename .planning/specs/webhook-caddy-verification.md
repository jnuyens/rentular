# Webhook + Caddy Verification Kit

Support doc for the m1 infra migration from PM2/nginx to Caddy + standard containers.
Concern raised: "webhooks might be affected." This kit lets you confirm that inbound
webhooks and the OAuth callback still work after the switch, without touching code.

## Background (what the app expects)

The Hono API runs under `.basePath("/api/v1")` (`apps/api/src/index.ts:42`). Every public
URL therefore starts with `/api/v1`. The three inbound third-party endpoints are:

| Endpoint | Method | Auth model | Full public path |
|---|---|---|---|
| GoCardless webhook | POST | `Webhook-Signature` HMAC over raw body | `https://www.rentular.com/api/v1/webhooks/gocardless` |
| Stripe webhook | POST | `stripe-signature` over raw body (`constructEvent`) | `https://www.rentular.com/api/v1/stripe/webhook` |
| Ponto OAuth callback | GET | state JWT (not session cookie) | `https://www.rentular.com/api/v1/bank-connections/callback` |

Key properties that make the app code proxy-robust:

- CSRF is explicitly skipped for `/webhooks/` and `/stripe/webhook` (`index.ts:83`), so the
  security middleware does not reject unauthenticated third-party POSTs.
- Webhook signatures are computed over the raw request body only. They do not depend on the
  Host header, scheme, or path, so TLS re-termination and host rewriting by the proxy are safe.
- The callback authenticates with a state JWT and builds its redirect target from env
  (`BANK_CONNECTION_REDIRECT_URL` / `WEB_URL`), not from the inbound request host.

So the remaining risk is entirely in the proxy and container layers, not the app.

## 1. Risk table

| # | Risk | Symptom | How it manifests | Check |
|---|---|---|---|---|
| 1 | Caddy strips the `/api/v1` prefix when proxying | App never sees `/api/v1/...`, sees `/webhooks/...` instead | 404 on every webhook and the callback (and the whole API, since all of it rides `/api/v1`) | Probe A, C, E below: a 404 means the prefix was dropped or the route is misrouted |
| 2 | Hardened header allowlist drops `Webhook-Signature` / `stripe-signature` | Signature header missing at the app | GoCardless returns 401 "Invalid signature"; Stripe returns 400 "Missing signature or webhook secret" even for genuinely signed calls | Provider dashboard "send test webhook" returns non-2xx; Probe B returns 401 as expected for unsigned but real signed calls also fail |
| 3 | Body-size cap / WAF / rate-limit on unauthenticated POSTs | Body truncated or request blocked before the app | Signature mismatch (401/400) on large or rapid webhooks, or a Caddy-level 403/413/429 that never reaches the app (no app log line) | Compare Caddy access log vs app log; a status with no matching app log line is proxy-level |
| 4 | Secrets not injected into the new container | Env vars absent in the API container | GoCardless returns 500 "Webhook secret not configured"; Ponto token decrypt fails on sync; NextAuth breaks if AUTH_SECRET missing | Probe B: a 500 here proves the secret is not injected. Also `GET /api/v1/health` and a login attempt |
| 5 | Deploy webhook receiver not re-homed | git-push deploy path gone | Push to main no longer triggers a deploy; receiver port unreachable | See section 4; check the receiver process/container and its Caddy route |

Secrets that MUST reach the API container (risk 4): `GOCARDLESS_WEBHOOK_SECRET`,
`STRIPE_WEBHOOK_SECRET`, `PONTO_*` (client id/secret, TLS cert/key/passphrase, env),
the token-encryption key used by `apps/api/src/lib/encryption.ts`, and `AUTH_SECRET`.

## 2. Known-good Caddyfile snippet (Caddy v2)

Minimal and correct. The order of the `handle` blocks matters: the `/api/v1/*` matcher
must come first so it wins over the catch-all to the web app.

```caddy
www.rentular.com, rentular.com {
	# API: everything under /api/v1 goes to the API container.
	# IMPORTANT: do NOT rewrite or strip the path. The app is mounted at
	# basePath("/api/v1") and expects to receive /api/v1/... verbatim.
	handle /api/v1/* {
		reverse_proxy api:4000
	}

	# Web app: everything else.
	handle {
		reverse_proxy web:3000
	}
}
```

Notes:

- Caddy `reverse_proxy` forwards all request headers and the request body verbatim by
  default. It does NOT drop custom headers, so `Webhook-Signature` and `stripe-signature`
  pass through as-is unless you add an explicit `header_up -Some-Header` or a restrictive
  matcher. Do not add header filtering that could remove the signature headers.
- Do NOT add a `handle_path` for the API block. `handle_path` strips the matched prefix,
  which would turn `/api/v1/webhooks/gocardless` into `/webhooks/gocardless` and break
  everything (risk 1). Use `handle` + `reverse_proxy` with no rewrite, as above.
- Do NOT set a `request_body { max_size ... }` low enough to clip webhook payloads. If you
  need a cap, keep it generous (for example several MB) so batched GoCardless events and
  Stripe payloads are never truncated (risk 3).
- Auto-HTTPS: serving both `www.rentular.com` and `rentular.com` makes Caddy provision and
  renew certificates automatically. Ensure both A records point at m1 and ports 80/443 are open.
- Where hardening is safe: TLS, HSTS/security response headers, and a generous global
  rate-limit are fine. Where it is NOT safe for these three paths: IP allowlists, bot/JS
  challenges, mTLS-required, aggressive per-path rate-limits, or header allowlists. Webhooks
  come from GoCardless/Stripe/Ponto server IPs with no browser fingerprint and must reach the
  app unauthenticated so the app can verify the signature itself. If you want per-path
  hardening, exclude `/api/v1/webhooks/*`, `/api/v1/stripe/webhook`, and
  `/api/v1/bank-connections/callback` from it.

## 3. Curl probe checklist (run against prod)

Each probe isolates a failure mode by status code. Run from your workstation against the
live host. None of these send a valid signature, so a 2xx is never expected from the webhook
probes; the point is WHICH non-2xx you get.

### Probe A: health (baseline routing + app up)
```sh
curl -s -o /dev/null -w '%{http_code}\n' https://www.rentular.com/api/v1/health
```
- `200` or `503`: proxy routes `/api/v1` to the API and the app answers (503 = DB/Redis
  degraded, but routing is fine).
- `404`: prefix stripped or API not routed (risk 1).
- `502` / `503` from Caddy with no JSON body: API container down or wrong upstream port.

### Probe B: GoCardless webhook (routing + secret injection + CSRF-exempt)
```sh
curl -s -o /dev/stderr -w '\nHTTP %{http_code}\n' \
  -X POST https://www.rentular.com/api/v1/webhooks/gocardless \
  -H 'Content-Type: application/json' -d '{}'
```
- `401` with `{"error":"Invalid signature"}`: BEST outcome. Request reached the app, the
  secret is present, CSRF did not block it, and only the (deliberately absent) signature
  failed. This path is healthy.
- `500` with `{"error":"Webhook secret not configured"}`: reached the app but
  `GOCARDLESS_WEBHOOK_SECRET` is not injected into the container (risk 4).
- `404`: routing/prefix broken (risk 1).
- `403` / `413` / `429`, or a body with no `{"error":...}` JSON: blocked at the proxy before
  the app (risk 2 or 3). Cross-check: no app log line for this request.

### Probe C: Stripe webhook (routing + CSRF-exempt)
```sh
curl -s -o /dev/stderr -w '\nHTTP %{http_code}\n' \
  -X POST https://www.rentular.com/api/v1/stripe/webhook \
  -H 'Content-Type: application/json' -d '{}'
```
- `400` with `{"error":"Missing signature or webhook secret"}`: reached the app (healthy for
  an unsigned probe). Note Stripe returns 400 for both missing-secret and bad-signature, so
  this probe cannot by itself distinguish secret injection; rely on the dashboard test below.
- `404`: routing/prefix broken (risk 1).
- proxy-level `403`/`413`/`429` or non-JSON body: blocked before the app (risk 2 or 3).

### Probe D: Ponto callback (GET routing)
```sh
curl -s -o /dev/null -w '%{http_code}\n' \
  'https://www.rentular.com/api/v1/bank-connections/callback'
```
- `302` (redirect to `/bank-connections/callback?error=missing_params`): healthy. The app
  received the GET, ran the state-JWT path, and redirected. Routing works.
- `404`: routing/prefix broken (risk 1), or the callback path is not proxied.
- `401`: the requireAuth exemption for `/callback` is not in effect (app-level, not proxy) —
  unlikely to be caused by the Caddy switch, but worth noting if seen.

### Probe E: prefix sanity (optional)
```sh
curl -s -o /dev/null -w '%{http_code}\n' https://www.rentular.com/webhooks/gocardless
```
- `404` expected. If this returns 401/500 instead, Caddy is stripping `/api/v1` and routing
  the stripped path to the API (risk 1) — the opposite of what you want.

### Real signed test (final confirmation)
Unsigned probes prove routing, CSRF-exemption, and secret presence, but not that a genuinely
signed webhook verifies end to end. For that, use the provider dashboards:
- GoCardless: Developers > Webhook endpoints > send a test event to the prod URL.
- Stripe: Developers > Webhooks > select the endpoint > "Send test webhook".
A 2xx there, plus the expected app log line and DB row, is the definitive pass.

## 4. Deploy webhook receiver re-homing

The Phase-10 git-push deploy path uses `deploy/webhook-receiver.mjs` (HMAC-verified), which
ran as the systemd unit `deploy/rentular-webhook.service` under the PM2/host model. Under
"standard containers" that systemd unit is likely gone. To restore push-to-deploy:

- Decide where the receiver runs: either keep it as a host-level systemd service (simplest,
  it needs docker/compose access to rebuild and restart the app containers), or run it in its
  own small container with the docker socket mounted.
- Give it a stable internal port and route it through Caddy on a dedicated path, for example:
  ```caddy
  handle /deploy-hook {
  	reverse_proxy deploy-receiver:9000
  }
  ```
  placed before the catch-all `handle`. Keep the HMAC secret (`DEPLOY_WEBHOOK_SECRET` or
  equivalent) injected wherever the receiver runs.
- Update the GitHub webhook URL if the path or host changed.
- This is separate from the payment webhooks above and is not payment-critical, but without
  it a `git push` no longer ships.

## Quick triage summary

- All probes 404 -> prefix stripped (risk 1); fix the Caddyfile per section 2.
- Probe B returns 500 -> secret not injected (risk 4); fix container env.
- Probe B returns 401 and Probe D returns 302 -> inbound path is healthy; move to a real
  signed dashboard test.
- Proxy-level 403/413/429 with no app log -> hardening is too aggressive (risk 2/3); exclude
  the three webhook/callback paths.
