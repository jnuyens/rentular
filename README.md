# Rentular

OpenSource real estate management platform built for the Belgian market, with international expansion in mind.

## Features

- **Property Management** - Track buildings, units, and their details
- **Tenant Management** - Manage tenant information and communication
- **Lease Management** - Belgian lease types (short/long/student/commercial) with regional law support
- **Payment Follow-up** - Track rent payments, send automated reminders for late payments
- **Rent Indexation** - Automatic rent adjustments based on the Belgian health index (Statbel)
- **GoCardless Integration** - SEPA Direct Debit for automated rent collection
- **Multi-language** - Dutch, French, German, and English

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15 (App Router) + Tailwind CSS |
| API | Hono |
| Database | MariaDB (default) or PostgreSQL |
| ORM | Drizzle |
| Auth | Auth.js (Google, Facebook, Twitter/X) |
| Payments | GoCardless |
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

### Using PostgreSQL instead of MariaDB

```bash
# Set DB_TYPE=postgres in .env, then:
docker compose -f docker-compose.postgres.yml up -d
```

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
