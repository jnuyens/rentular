# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# @rentular/api — Hono + BullMQ workers, built as a tsup ESM bundle.
# Multi-stage: prune the monorepo to this app's closure, build the bundle,
# install prod-only deps, then run `node dist/index.mjs` on a slim runner.
# The BullMQ workers (email/sms/import/payment cron) auto-start on import of
# src/index.ts, so running this one container also runs the workers in-process.
# Reaches infra via compose service names (mariadb, redis), not localhost.
# ---------------------------------------------------------------------------
FROM node:20-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# Playwright (Smovin import) browsers are not exercised by the containerised
# API in this pre-release; skip the multi-hundred-MB browser download.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN corepack enable
WORKDIR /app

# --- prune: trim the workspace to @rentular/api's dependency closure ---
FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@2.3.0 prune @rentular/api --docker

# --- builder: full install + tsup ESM build (dist/index.mjs) ---
FROM base AS builder
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN pnpm --filter @rentular/api build

# --- runner: prod-only deps + built bundle ---
FROM base AS runner
ENV NODE_ENV=production
COPY --from=pruner /app/out/json/ .
RUN pnpm install --prod --frozen-lockfile
COPY --from=builder /app/apps/api/dist ./apps/api/dist
USER node
EXPOSE 4000
CMD ["node", "apps/api/dist/index.mjs"]
