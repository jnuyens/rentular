# Contributing to Rentular

Thanks for wanting to help. Bug reports, fixes, translations and small
features are all welcome. For anything larger, open an issue first so we can
agree on the approach before you spend time on it.

## Running it

Follow "Getting Started" in [README.md](README.md). In short:

```bash
pnpm install
cp .env.example .env
docker compose up -d
set -a; . ./.env; set +a
pnpm db:push
pnpm dev
```

Use `pnpm db:push` for schema changes. Do not use `pnpm db:generate` or
`pnpm db:migrate`; the migration history in `packages/db/drizzle` is out of
date.

## Before you open a pull request

```bash
# Unit tests
pnpm --filter @rentular/api test
pnpm --filter @rentular/mcp-server test

# Type checks
pnpm --filter @rentular/api lint
pnpm --filter @rentular/web lint

# Formatting
pnpm format
```

Add or update a vitest test next to the code you change (API tests live in
`__tests__` folders under `apps/api/src`). A pull request should leave the
tests green.

## Code conventions

- TypeScript in strict mode. No implicit `any`.
- Prettier formats everything (`pnpm format`).
- API routes are Hono routers, validated with Zod.
- Log lines start with a context tag, for example `[EmailQueue]`.
- Comments explain why something is done, not what the next line does.

## Translations

The web app is available in English, Dutch, French and German. Every
user-facing string must exist in all four files:

- `apps/web/messages/en/common.json`
- `apps/web/messages/nl/common.json`
- `apps/web/messages/fr/common.json`
- `apps/web/messages/de/common.json`

If you are not comfortable writing one of the languages, add your best attempt
and say so in the pull request; someone will review it.

## Commit messages

Short and in the imperative, with a type prefix:

```
fix(api): skip reminders for leases that ended
feat(web): show the next indexation date on the lease page
docs: explain the PM2 setup
```

Common types are `feat`, `fix`, `docs`, `test`, `refactor` and `chore`. One
logical change per commit.

## Security issues

Please do not report security problems in a public issue. Email the
maintainer (see the GitHub profile of the repository owner) and give us a
chance to fix it first.

## License

Rentular is licensed under the [AGPL-3.0](LICENSE). By contributing, you agree
that your contribution is published under the same license.
