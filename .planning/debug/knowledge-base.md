# GSD Debug Knowledge Base

Resolved debug sessions. Used by `bm-debugger` to surface known-pattern hypotheses at the start of new investigations.

---

## smovin-import-write-failure: Smovin import data quality (duplicate leases, hardcoded tenant language, blanket lease skip) and Chrome Google login failing behind the reverse proxy
- **Date:** 2026-10-06
- **Error patterns:** smovin, import, duplicate leases, wrong rent, no payments imported, tenant language nl, indexation date same for all leases, startDate fallback today, import counts 0 eigendommen, Google login Chrome fails, Safari works, trustHost, NextAuth v5, reverse proxy, CSRF, Import Voltooid
- **Root cause:** (8) NextAuth v5 config lacked `trustHost: true`, so behind the Caddy/PM2 reverse proxy fresh sessions failed the host check in Chrome while Safari rode a cached session. (2/6) importWriteWorker skipped ALL lease imports once a property had any lease, and otherwise inserted every discovered lease with no dedup. (4) mapSmovinTenant hardcoded `language: "nl"`; Smovin exposes no per-tenant language. (1/5) rent and start-date scraping are regex-over-page-text heuristics that miss or mis-match on real Smovin pages; the start-date miss makes every lease fall back to today, which is why all indexation dates were identical. (3) discovery never scrapes payments, so the write worker always gets `payments: []`.
- **Fix:** `trustHost: true` in apps/web/lib/auth.ts. Per-lease `findExistingLease(propertyId, startDate)` dedup replacing the blanket skip in importWriteWorker.ts. Smovin UI locale detected from the URL in importDiscoveryWorker.ts and mapped via `mapTenantLanguage()` with an explicit "nl" fallback; the language source is written into the tenant notes. "Huidige index" removed from the rent regex. Issues 1 and 5 remain blocked on access to a real Smovin account to capture page HTML (do not guess selectors); issue 3 deferred as a follow-on scraping task. Lesson: when a prod auth bug is browser-specific and the app sits behind a proxy, check `trustHost`/`AUTH_URL` and canonical host (apex vs www) before suspecting cookies.
- **Files changed:** apps/web/lib/auth.ts, apps/api/src/jobs/importWriteWorker.ts, apps/api/src/jobs/importDiscoveryWorker.ts, apps/api/src/services/smovinMapper.ts, apps/api/src/services/__tests__/smovinMapper.test.ts
---

