<p align="center">
  <img src="apps/web/public/rentular.png" alt="Rentular" width="280" />
</p>

<h1 align="center">Rentular</h1>

<p align="center">
  OpenSource real estate management platform built for the Belgian market, with international expansion in mind.
</p>

<p align="center">
  <a href="https://github.com/jnuyens/rentular/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="License" /></a>
</p>

## Features

- **Property Management** - Track buildings, units, and their details
- **Tenant Management** - Manage tenant information and communication
- **Lease Management** - Belgian lease types (short/long/student/commercial) with regional law support
- **Payment Follow-up** - Track rent payments, send automated reminders for late payments
- **Rent Indexation** - Automatic rent adjustments based on the Belgian health index (Statbel)
- **GoCardless Integration** - SEPA Direct Debit for automated rent collection
- **Bank Connections** - Match incoming transfers through Ponto (PSD2)
- **Periodic Maintenance** - Track fire alarm inspections, heating maintenance, chimney sweeps
- **Stripe Subscriptions** - Hosted checkout with card, Bancontact, and iDEAL support
- **Multi-language** - Dutch, French, German, and English

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15 (App Router) + Tailwind CSS |
| API | Hono |
| Database | MySQL / MariaDB |
| ORM | Drizzle |
| Auth | Auth.js (email and password, Google, Facebook, Twitter/X) |
| Payments | GoCardless + Stripe |
| Background Jobs | BullMQ + Redis |
| Monorepo | Turborepo + pnpm |

## Project Structure

```
rentular/
  apps/
    web/              Next.js frontend (dashboard, sign-in, public pages)
    api/              Hono REST API, also runs the background jobs
    mcp-server/       MCP server so Claude can work with your Rentular data
  packages/
    db/               Drizzle ORM schema and database connection
    shared/           Types, validation, constants (indexation, formats, versions)
  infra/
    cloudflare/inbound-email/   Email worker for tenant replies
  android-app/        Android WebView app
  deploy/             Example deploy script, nginx config, Ponto certificate helper
```

Parts with their own docs:

- [apps/mcp-server/README.md](apps/mcp-server/README.md): connect Claude Desktop or Claude Code to Rentular.
- [infra/cloudflare/inbound-email/README.md](infra/cloudflare/inbound-email/README.md): route tenant replies back into Rentular.
- [android-app/README.md](android-app/README.md): build the Android app, and how it checks server versions.

## Self-hosting

To run Rentular on your own server, read [SELF-HOSTING.md](SELF-HOSTING.md).
It covers Docker compose and a plain Node/PM2 setup, the reverse proxy, the
database, the first account, webhooks, updates and backups.

## Getting Started (development)

### Prerequisites

- Node.js 20.19, pinned through Volta in [`package.json`](package.json). Any later 20.x works too.
- pnpm 9.15, from the `packageManager` field in [`package.json`](package.json). `corepack enable` picks it up.
- Docker and Docker Compose, for MariaDB, Redis and Mailpit.

If you use Homebrew on macOS:

```bash
brew install node@20
export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
corepack enable
```

### Setup

```bash
# Clone the repository
git clone https://github.com/jnuyens/rentular.git
cd rentular

# Install dependencies
pnpm install

# Copy the environment file, then edit it
cp .env.example .env

# Start infrastructure (MariaDB + Redis + Mailpit)
docker compose up -d

# Nothing reads .env by itself, so export it into your shell
set -a; . ./.env; set +a

# Create the tables on the fresh database
pnpm db:push

# Start the development servers
pnpm dev
```

The web app will be available at http://localhost:3000 and the API at http://localhost:4000.

For email testing, Mailpit UI is at http://localhost:8025.

Do not run `pnpm db:generate` or `pnpm db:migrate`: the migration history in
`packages/db/drizzle` does not match the current schema. Use `pnpm db:push`.
On MariaDB, `db:push` only works against an empty database; see
[SELF-HOSTING.md](SELF-HOSTING.md#database).

### Checks

```bash
# Type-check the API, the web app, or the whole workspace
pnpm --filter @rentular/api lint
pnpm --filter @rentular/web lint
pnpm lint

# Unit tests (vitest)
pnpm --filter @rentular/api test
pnpm --filter @rentular/mcp-server test
```

## Belgian Rental Law

Rentular implements Belgian rental law specifics:

- **Rent Indexation**: Calculated using the health index from Statbel. Formula: `new_rent = base_rent * (current_index / base_index)`
- **Regional Differences**: Flanders (automatic indexation), Wallonia and Brussels (must be requested within 3 months)
- **Brussels EPC Restrictions**: Since October 2022, Brussels limits indexation based on energy performance certificates
- **Structured Communication**: Belgian bank transfer reference format (+++xxx/xxxx/xxxxx+++)
- **Lease Types**: Short (max 3y), long (9y standard), lifetime, student, commercial

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to run things, the checks, and what a pull request needs.

## License

This project is licensed under the AGPL-3.0 License. See [LICENSE](LICENSE) for details.
