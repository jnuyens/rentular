# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# @rentular/web — Next.js 15 standalone SSR server.
# Multi-stage: prune the monorepo to this app's closure, build the standalone
# output, then run the traced server on a slim runner.
#
# CRITICAL: NEXT_PUBLIC_API_URL is statically inlined into the browser (and
# server-component) bundle at `next build` time. It MUST be supplied as a
# build ARG so it is baked in — a runtime-only env var is IGNORED by the
# already-compiled bundle and the browser would fall back to localhost:4000.
# The prod value (https://rentular.com/api/v1) is passed via compose build.args
# in Plan 04; do not hardcode it here.
#
# Standalone in a Turbo/pnpm monorepo emits the server at the deep path
# apps/web/.next/standalone/apps/web/server.js (outputFileTracingRoot = repo
# root), so the runner copies preserve the nested apps/web/... layout.
# ---------------------------------------------------------------------------
FROM node:20-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

# --- prune: trim the workspace to @rentular/web's dependency closure ---
FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@2.3.0 prune @rentular/web --docker

# --- builder: full install + Next standalone build (API URL baked in) ---
FROM base AS builder
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm --filter @rentular/web build

# --- runner: standalone server + static assets ---
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
