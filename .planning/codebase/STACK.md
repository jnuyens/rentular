# Technology Stack

**Analysis Date:** 2026-06-28

## Languages

**Primary:**
- TypeScript 5.5.0 - All application code across API, web, db, and shared packages

**Secondary:**
- JavaScript (Node.js) - Runtime execution of compiled TypeScript output

## Runtime

**Environment:**
- Node.js 20.19.0 (pinned via Volta in `/Users/jnuyens/src/rentular/source/package.json`)
- Minimum required: Node.js >= 20.0.0

**Package Manager:**
- pnpm 9.15.0
- Lockfile: `pnpm-lock.yaml` (present at project root)

## Frameworks

**API (`apps/api`):**
- Hono 4.6.0 — lightweight HTTP framework, base path `/api/v1`; uses built-in `cors`, `csrf`, `logger`, `prettyJSON` middleware
- @hono/node-server 1.13.0 — Node.js adapter for `serve()`
- @hono/zod-validator 0.4.0 — request validation middleware (`zValidator("json", schema)`)

**Web (`apps/web`):**
- Next.js 15.1.0 — App Router, SSR, server actions; dev on port 3000
- React 19.0.0 + React DOM 19.0.0 — UI rendering
- next-auth 5.0.0-beta.25 — JWT-session authentication; credentials + OAuth providers
- @auth/drizzle-adapter 1.11.1 — NextAuth session/user persistence via Drizzle
- next-intl 3.24.0 — i18n plugin; messages in `apps/web/messages/{en,nl,fr,de}/`; configured via `apps/web/lib/i18n.ts`
- next-themes 0.4.6 — light/dark theme toggle
- @tanstack/react-query 5.62.0 — client-side data fetching and cache

**UI Components (`apps/web`):**
- Tailwind CSS 3.4.16 + tailwindcss-animate 1.0.7
- PostCSS 8.4.49 + Autoprefixer 10.4.20
- Radix UI primitives: `@radix-ui/react-alert-dialog`, `react-dialog`, `react-dropdown-menu`, `react-label`, `react-radio-group`, `react-select`, `react-separator`, `react-slot`, `react-tabs`, `react-tooltip` (all ^1.x/^2.x)
- class-variance-authority 0.7.1 — variant-based component styling
- clsx 2.1.1 + tailwind-merge 2.6.0 — className utilities
- lucide-react 0.468.0 — icon library
- sonner 2.0.7 — toast notifications

**Testing (`apps/api`):**
- Vitest 4.1.2 — unit and integration test runner; config at `apps/api/vitest.config.ts`
- msw 2.6.0 — HTTP mock service worker for API-layer tests

**Build & Dev:**
- Turbo 2.3.0 — monorepo orchestration; tasks defined in `/Users/jnuyens/src/rentular/source/turbo.json`
- tsup 8.3.0 — bundles API to `dist/` (ESM + `.d.ts`); entry: `apps/api/src/index.ts`
- tsx 4.19.0 — TypeScript executor for API dev (`tsx watch src/index.ts`)

## Key Dependencies

**ORM & Database:**
- Drizzle ORM 0.36.0 — type-safe query builder; used in all packages
- mysql2 3.11.0 — MySQL/MariaDB driver with connection pooling (`mysql2/promise`)
- Drizzle-kit 0.31.9 — schema generate, migrate, push, studio; config at `packages/db/drizzle.config.ts`

**Auth & Crypto:**
- jose 6.2.1 — JWT sign/verify/decrypt (`SignJWT`, `jwtVerify`, `jwtDecrypt`); used for session JWT decryption and OAuth state tokens
- @panva/hkdf 1.2.1 — HKDF key derivation matching Auth.js's `getDerivedEncryptionKey()` pattern
- bcrypt 5.1.0 — password hashing for credentials login

**Queue & Caching:**
- BullMQ 5.25.0 — Redis-backed job queue; queues: `email-queue`, `sms-queue`, `payment-check`, `health-index-refresh`, `import-discovery`, `import-write`
- ioredis 5.4.0 — Redis client for BullMQ connections and health check

**Payment Integrations:**
- stripe 20.4.1 — Rentular subscription billing; checkout sessions, webhooks
- gocardless-nodejs 4.2.0 — SEPA direct debit mandate setup and payment collection

**PSD2 / Bank Data:**
- nordigen-node 1.4.1 — GoCardless Bank Account Data (legacy/dormant; formerly Nordigen); dynamically imported
- No Ponto SDK — Ponto Connect (Ibanity) is integrated via hand-written REST client at `apps/api/src/lib/pontoConnect.ts`

**Scraping (Smovin importer):**
- playwright 1.58.2 — headless Chromium browser automation
- playwright-extra 4.3.6 — Playwright plugin host
- puppeteer-extra-plugin-stealth 2.11.2 — anti-detection stealth mode

**Communication:**
- nodemailer 6.9.0 — SMTP email sending; per-landlord custom SMTP with 30-min transport cache
- Zod 3.24.0 — schema validation (all packages)

**Shared utilities:**
- `@rentular/shared` (`packages/shared/src/`) — common TypeScript types, Zod schemas, constants; exported via `./constants`, `./types`, `./validation` sub-path exports

## TypeScript Configuration

**Root (`/Users/jnuyens/src/rentular/source/tsconfig.json`):**
- `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`
- `strict: true` — all strict checks enabled; implicit `any` forbidden
- `noEmit: true`, `isolatedModules: true`, `incremental: true`

**Path aliases:**
- `@/` → `apps/web/` (Next.js convention, via `tsconfig.json` in that package)
- No aliases in the API; relative imports only

## Configuration

**Environment:**
- Single `.env` file at project root (template: `.env.example`)
- Variables scoped by domain — see INTEGRATIONS.md for per-service env vars

**Build outputs:**
- API: `apps/api/dist/` (tsup ESM bundle)
- Web: `apps/web/.next/` (Next.js build)

## Platform Requirements

**Development:**
- Node.js 20.19.0 (Volta-pinned)
- pnpm 9.15.0
- MariaDB 11 or MySQL 5.7+ (Docker: `mariadb:11` image per `docker-compose.yml`)
- Redis 7 Alpine (Docker: `redis:7-alpine`)
- Mailpit (Docker: `axllent/mailpit:latest`) — local SMTP catch-all on port 1025, web UI on 8025

**Production:**
- Proxmox/Hetzner VPS with Docker
- MariaDB 11 persistent volume
- Redis 7 persistent volume
- API on port 4000 (configurable via `API_PORT`)
- Web on port 3000 (Next.js standard)

---

*Stack analysis: 2026-06-28*
