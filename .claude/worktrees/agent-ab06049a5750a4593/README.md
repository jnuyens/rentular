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
| Auth | Auth.js (Google, Facebook, Twitter/X) |
| Payments | GoCardless + Stripe |
| Background Jobs | BullMQ + Redis |
| Monorepo | Turborepo + pnpm |

## Project Structure

```
rentular/
  apps/
    web/              # Next.js frontend (dashboard)
    api/              # Hono REST API
  packages/
    db/               # Drizzle ORM schema + migrations
    shared/           # Types, validation, constants
    indexation/       # Belgian rent indexation logic
    payments/         # GoCardless payment abstraction
    notifications/    # Email/SMS notification service
```

## Getting Started

### Prerequisites

- Node.js >= 20
- pnpm >= 9
- Docker and Docker Compose

The repository includes [`.nvmrc`](/Users/jnuyens/rentular/source/.nvmrc), [`.node-version`](/Users/jnuyens/rentular/source/.node-version), and a Volta pin in [`package.json`](/Users/jnuyens/rentular/source/package.json) so local shells can stay on Node 20 consistently.

If you use Homebrew on macOS:

```bash
brew install node@20
export PATH="/opt/homebrew/opt/node@20/bin:$PATH"
```

### Setup

```bash
# Clone the repository
git clone https://github.com/rentular/rentular.git
cd rentular

# Install dependencies
pnpm install

# Copy environment file
cp .env.example .env
# Edit .env with your configuration

# Start infrastructure (MariaDB + Redis + Mailpit)
docker compose up -d

# Run database migrations
pnpm db:push

# Start development servers
pnpm dev
```

The web app will be available at http://localhost:3000 and the API at http://localhost:4000.

For email testing, Mailpit UI is at http://localhost:8025.

### Validation

```bash
# Validate the API
pnpm --filter @rentular/api lint

# Validate the web app
pnpm --filter @rentular/web lint

# Validate the full workspace
pnpm lint
```

### Current Scope

- Database support is MySQL / MariaDB only.
- Email/password registration, login, password reset, and account password/email changes are implemented.
- Payment collection and payment mutation endpoints that do not persist data yet return `501 Not Implemented` instead of reporting false success.

## Belgian Rental Law

Rentular implements Belgian rental law specifics:

- **Rent Indexation**: Calculated using the health index from Statbel. Formula: `new_rent = base_rent * (current_index / base_index)`
- **Regional Differences**: Flanders (automatic indexation), Wallonia and Brussels (must be requested within 3 months)
- **Brussels EPC Restrictions**: Since October 2022, Brussels limits indexation based on energy performance certificates
- **Structured Communication**: Belgian bank transfer reference format (+++xxx/xxxx/xxxxx+++)
- **Lease Types**: Short (max 3y), long (9y standard), lifetime, student, commercial

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting a pull request.

## License

This project is licensed under the AGPL-3.0 License - see the LICENSE file for details.
