# Technology Stack

**Analysis Date:** 2026-06-24

## Languages

**Primary:**
- TypeScript 5.5.0 - All application code (API, web app, shared utilities, database schema)

**Secondary:**
- JavaScript (Node.js) - Runtime execution for TypeScript-compiled output

## Runtime

**Environment:**
- Node.js 20.19.0 (pinned via `volta` in `package.json`)
- Minimum requirement: `engines.node >= 20.0.0`

**Package Manager:**
- pnpm 9.15.0 - Monorepo package manager (`packageManager` field in `package.json`)
- Lockfile: `pnpm-lock.yaml` (present at repo root)

## Frameworks

**Core:**
- Next.js 15.1.0 - Web frontend framework (`apps/web/package.json`)
- Hono 4.6.0 - Lightweight HTTP server framework for API (`apps/api/package.json`)

**Authentication:**
- NextAuth.js 5.0.0-beta.25 - User authentication and session management (`apps/web/package.json`)
- @auth/drizzle-adapter 1.11.1 - Drizzle ORM adapter for NextAuth session/user storage (`apps/web/package.json`)

**API & HTTP:**
- @hono/node-server 1.13.0 - Node.js server adapter for Hono (`apps/api/package.json`)
- @hono/zod-validator 0.4.0 - Zod-based request validation middleware for Hono (`apps/api/package.json`)

**Database:**
- Drizzle ORM 0.36.0 - Type-safe SQL ORM (`apps/api/package.json`, `apps/web/package.json`, `packages/db/package.json`)
- Drizzle-kit 0.31.9 - Schema generation and migration CLI (`packages/db/package.json`)
- mysql2 3.11.0 - MySQL database driver (`packages/db/package.json`)
- Drizzle config: `packages/db/drizzle.config.ts` (MySQL dialect, schema glob `./src/schema/*.ts`, output `./drizzle`)

**Queue & Job Processing:**
- BullMQ 5.25.0 - Redis-backed job queue for async task processing (`apps/api/package.json`)
- ioredis 5.4.0 - Redis client for queue connections (`apps/api/package.json`)

**UI & Frontend:**
- React 19.0.0 - UI component library (`apps/web/package.json`)
- React DOM 19.0.0 - DOM rendering (`apps/web/package.json`)
- Tailwind CSS 3.4.16 - Utility-first CSS framework (`apps/web/package.json`)
- PostCSS 8.4.49 - CSS transformation tool (`apps/web/package.json`)
- Autoprefixer 10.4.20 - CSS vendor prefix generation (`apps/web/package.json`)
- Lucide React 0.468.0 - Icon library (`apps/web/package.json`)
- clsx 2.1.1 - Conditional className utility (`apps/web/package.json`)
- tailwind-merge 2.6.0 - Tailwind CSS class conflict resolver (`apps/web/package.json`)
- tailwindcss-animate 1.0.7 - Animation utilities for Tailwind (`apps/web/package.json`)

**UI Component Primitives (Radix UI):**
- @radix-ui/react-alert-dialog 1.1.15 (`apps/web/package.json`)
- @radix-ui/react-dialog 1.1.15 (`apps/web/package.json`)
- @radix-ui/react-dropdown-menu 2.1.16 (`apps/web/package.json`)
- @radix-ui/react-label 2.1.8 (`apps/web/package.json`)
- @radix-ui/react-radio-group 1.3.8 (`apps/web/package.json`)
- @radix-ui/react-select 2.2.6 (`apps/web/package.json`)
- @radix-ui/react-separator 1.1.8 (`apps/web/package.json`)
- @radix-ui/react-slot 1.2.4 (`apps/web/package.json`)
- @radix-ui/react-tabs 1.1.13 (`apps/web/package.json`)
- @radix-ui/react-tooltip 1.2.8 (`apps/web/package.json`)
- class-variance-authority 0.7.1 - Variant-based component styling (shadcn/ui pattern) (`apps/web/package.json`)

**UI Utilities:**
- next-themes 0.4.6 - Dark/light theme switching (`apps/web/package.json`)
- sonner 2.0.7 - Toast notifications (`apps/web/package.json`)

**Data Query:**
- @tanstack/react-query 5.62.0 - Client-side data fetching and caching (`apps/web/package.json`)

**Internationalization:**
- next-intl 3.24.0 - Multi-language support for Next.js (en, nl, fr, de) (`apps/web/package.json`)

**Validation:**
- Zod 3.24.0 - Schema validation (`packages/shared/package.json`, `apps/api/package.json`, `apps/web/package.json`)

**Build & Development:**
- tsup 8.3.0 - TypeScript bundler for API production builds (`apps/api/package.json`)
- tsx 4.19.0 - TypeScript executor for API development server (`apps/api/package.json`)
- Turbo 2.3.0 - Monorepo build system and task orchestrator (`package.json`)
- Prettier 3.2.0 - Code formatter (`package.json`)
- TypeScript 5.5.0 - Language and type checking (all packages)

**Testing:**
- Vitest 4.1.2 - Test runner for API (`apps/api/package.json`, config at `apps/api/vitest.config.ts`)
- msw 2.6.0 - Mock Service Worker for HTTP mocking in tests (`apps/api/package.json` devDependencies)

**Cryptography & Security:**
- bcrypt 5.1.0 - Password hashing (`apps/api/package.json`, `apps/web/package.json`)
- jose 6.2.1 - JWT handling and cryptographic operations (`apps/api/package.json`)
- @panva/hkdf 1.2.1 - Key derivation function (`apps/api/package.json`)

**Browser Automation:**
- playwright 1.58.2 - Headless browser automation (`apps/api/package.json`, used in `apps/api/src/services/smovinScraper.ts`)
- playwright-extra 4.3.6 - Playwright with plugin support (`apps/api/package.json`)
- puppeteer-extra-plugin-stealth 2.11.2 - Anti-bot-detection stealth plugin for playwright-extra (`apps/api/package.json`)

## Key Dependencies

**Payment & Financial:**
- stripe 20.4.1 - Stripe subscription billing SDK (`apps/api/package.json`)
- gocardless-nodejs 4.2.0 - GoCardless SEPA direct debit SDK (`apps/api/package.json`)

**Open Banking:**
- nordigen-node 1.4.1 - Nordigen/GoCardless bank account data (PSD2) SDK (`apps/api/package.json`, used in `apps/api/src/lib/bankAccountData.ts`)

**Email & Communications:**
- nodemailer 6.9.0 - Email sending library (`apps/api/package.json`)

**Type Definitions:**
- @types/node 22.0.0 - Node.js type definitions (`apps/api/package.json`, `apps/web/package.json`)
- @types/react 19.0.0 - React type definitions (`apps/web/package.json`)
- @types/react-dom 19.0.0 - React DOM type definitions (`apps/web/package.json`)
- @types/bcrypt 5.0.0+ - bcrypt type definitions (`apps/api/package.json`, `apps/web/package.json`)
- @types/nodemailer 6.4.0 - nodemailer type definitions (`apps/api/package.json`)

## Configuration

**Environment:**
- Configured via `.env` file (example template at `.env.example`)
- Turbo watches `**/.env.*local` as global dependencies

**Key Configuration Groups:**
- **Database:** `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`
- **Redis:** `REDIS_URL` (or `REDIS_HOST`/`REDIS_PORT`)
- **Authentication:** `AUTH_SECRET`, `AUTH_URL`, `AUTH_GOOGLE_*`, `AUTH_FACEBOOK_*`, `AUTH_TWITTER_*`
- **Payment:** `STRIPE_SECRET_KEY`, `STRIPE_PRICE_*`, `STRIPE_WEBHOOK_SECRET`, `GOCARDLESS_ACCESS_TOKEN`, `GOCARDLESS_ENVIRONMENT`, `GOCARDLESS_WEBHOOK_SECRET`
- **Email:** `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `EMAIL_RATE_LIMIT`
- **SMS:** `SMS_PROVIDER`, `SMS_RATE_LIMIT`, provider-specific (`TWILIO_*`, `MESSAGEBIRD_*`, `OVH_*`)
- **API & Web URLs:** `API_PORT`, `API_URL`, `WEB_URL`, `NEXT_PUBLIC_API_URL`

**Build Configuration:**
- Root TypeScript config: `tsconfig.json` (target ES2022, strict mode, `moduleResolution: bundler`)
- API TypeScript config: `apps/api/tsconfig.json` (path alias `@/*` → `./src/*`, outDir `dist`)
- Web TypeScript config: `apps/web/tsconfig.json` (path alias `@/*` → `./`, JSX preserve, Next.js plugin)
- Turbo task graph: `turbo.json` (build, dev, lint, clean, db:generate, db:migrate, db:push)
- Drizzle config: `packages/db/drizzle.config.ts` (MySQL dialect, schema `./src/schema/*.ts`)
- Vitest config: `apps/api/vitest.config.ts` (node environment, glob `src/**/__tests__/**/*.test.ts`)

## Platform Requirements

**Development:**
- Node.js 20.0.0 or higher (20.19.0 recommended via Volta)
- pnpm 9.15.0
- MySQL 5.7+ (or compatible)
- Redis (for BullMQ queue processing)

**Production:**
- Node.js 20.0.0 or higher
- MySQL database instance
- Redis instance for job queues
- SMTP server (or Mailpit for local development) for email delivery
- Optional: Stripe account for subscription billing
- Optional: GoCardless account for SEPA direct debits
- Optional: Nordigen/GoCardless bank data account for PSD2 bank connections
- Optional: SMS provider (Twilio, MessageBird, OVH)
- Deployment target: Docker on Proxmox/Hetzner VPS

---

*Stack analysis: 2026-06-24*
