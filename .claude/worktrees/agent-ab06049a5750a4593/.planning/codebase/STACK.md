# Technology Stack

**Analysis Date:** 2026-03-22

## Languages

**Primary:**
- TypeScript 5.5.0 - All application code (API, web app, shared utilities, database)

**Secondary:**
- JavaScript (Node.js) - Runtime execution for TypeScript-compiled code

## Runtime

**Environment:**
- Node.js 20.19.0 (as specified in `volta` config in `/Users/jnuyens/rentular/source/package.json`)
- Minimum version requirement: Node.js >= 20.0.0

**Package Manager:**
- pnpm 9.15.0 - Monorepo package manager
- Lockfile: pnpm-lock.yaml (present at `/Users/jnuyens/rentular/source/pnpm-lock.yaml`)

## Frameworks

**Core:**
- Next.js 15.1.0 - Web frontend framework (`apps/web/package.json`)
- Hono 4.6.0 - Lightweight HTTP server framework for API (`apps/api/package.json`)

**Authentication:**
- NextAuth.js 5.0.0-beta.25 - User authentication and session management in web app (`apps/web/package.json`)
- DrizzleAdapter 1.11.1 - NextAuth adapter for database-backed session/user storage

**API & HTTP:**
- @hono/node-server 1.13.0 - Node.js server adapter for Hono
- @hono/zod-validator 0.4.0 - Zod-based request/response validation middleware for Hono

**Database:**
- Drizzle ORM 0.36.0 - Type-safe SQL ORM (api, web, and db packages)
- Drizzle-kit 0.31.9 - CLI tool for schema generation and migrations (`packages/db/package.json`)
- mysql2 3.11.0 - MySQL database driver (`packages/db/package.json`)

**Queue & Job Processing:**
- BullMQ 5.25.0 - Redis-backed job queue for async task processing (`apps/api/package.json`)
- ioredis 5.4.0 - Redis client for queue connections and caching

**UI & Frontend:**
- React 19.0.0 - UI component library
- React DOM 19.0.0 - DOM rendering
- Tailwind CSS 3.4.16 - Utility-first CSS framework (`apps/web/package.json`)
- PostCSS 8.4.49 - CSS transformation tool
- Autoprefixer 10.4.20 - CSS vendor prefix generation
- Lucide React 0.468.0 - Icon library
- clsx 2.1.1 - Conditional className utility
- tailwind-merge 2.6.0 - Tailwind CSS class conflict resolver

**Data Query:**
- @tanstack/react-query 5.62.0 - Client-side data fetching and caching

**Internationalization:**
- next-intl 3.24.0 - Multi-language support for Next.js (support for en, nl, fr, de)

**Validation:**
- Zod 3.24.0 - Schema validation library (shared, api, web packages)

**Build & Development:**
- tsup 8.3.0 - TypeScript bundler for API builds (`apps/api/package.json`)
- tsx 4.19.0 - TypeScript executor for development server (`apps/api/package.json`)
- Turbo 2.3.0 - Monorepo build system and task orchestrator
- Prettier 3.2.0 - Code formatter
- TypeScript 5.5.0 - Language and type checking

**Cryptography & Security:**
- bcrypt 5.1.0 - Password hashing (both api and web)
- jose 6.2.1 - JWT handling and cryptographic operations (`apps/api/package.json`)
- @panva/hkdf 1.2.1 - Key derivation function (`apps/api/package.json`)

## Key Dependencies

**Payment & Financial:**
- stripe 20.4.1 - Stripe payment processing SDK (`apps/api/package.json`)
- gocardless-nodejs 4.2.0 - GoCardless SEPA direct debit SDK (`apps/api/package.json`)

**Email & Communications:**
- nodemailer 6.9.0 - Email sending library (`apps/api/package.json`)

**Utilities:**
- @types/node 22.0.0 - Type definitions for Node.js
- @types/react 19.0.0 - React type definitions (web)
- @types/react-dom 19.0.0 - React DOM type definitions (web)
- @types/bcrypt 5.0.0+ - Bcrypt type definitions
- @types/nodemailer 6.4.0 - Nodemailer type definitions

## Configuration

**Environment:**
- Configured via `.env` file (example template at `.env.example`)
- Environment variables for database, Redis, authentication, payment providers, and email

**Key Configuration Groups:**
- **Database:** DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD
- **Redis:** REDIS_URL (or REDIS_HOST/REDIS_PORT)
- **Authentication:** AUTH_SECRET, AUTH_URL, AUTH_GOOGLE_*, AUTH_FACEBOOK_*, AUTH_TWITTER_*
- **Payment:** STRIPE_SECRET_KEY, STRIPE_PRICE_*, STRIPE_WEBHOOK_SECRET, GOCARDLESS_ACCESS_TOKEN, GOCARDLESS_ENVIRONMENT, GOCARDLESS_WEBHOOK_SECRET
- **Email:** SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM, EMAIL_RATE_LIMIT
- **SMS:** SMS_PROVIDER, SMS_RATE_LIMIT, provider-specific credentials (TWILIO_*, MESSAGEBIRD_*, OVH_*)
- **API & Web URLs:** API_PORT, API_URL, WEB_URL, NEXT_PUBLIC_API_URL

**Build Configuration:**
- `tsconfig.json` at project root with strict TypeScript settings (target: ES2022, strict mode enabled)
- Turbo task configuration in `turbo.json` for monorepo orchestration
- Drizzle ORM configuration in `packages/db/drizzle.config.ts` for MySQL dialect
- Next.js configuration (if exists, not explicitly read)

## Platform Requirements

**Development:**
- Node.js 20.0.0 or higher
- pnpm 9.15.0
- MySQL 5.7+ (or compatible)
- Redis (for BullMQ queue processing)

**Production:**
- Node.js 20.0.0 or higher
- MySQL database instance
- Redis instance for job queues
- SMTP server or Mailpit for email
- Optional: Stripe account for subscription payments
- Optional: GoCardless account for SEPA direct debits
- Optional: SMS provider (Twilio, MessageBird, OVH) for SMS communications

---

*Stack analysis: 2026-03-22*
