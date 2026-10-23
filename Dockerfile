# syntax=docker/dockerfile:1

# Debian bookworm-slim instead of alpine:
# Prisma 5.x engines need OpenSSL shared libs; Debian provides libssl3 (openssl 3.x)
# reliably, avoiding the "libssl.so.1.1: No such file or directory" musl/openssl
# detection failures seen on node:20-alpine.
#
# Node 22: the same major version CI runs the tests on (.github/workflows/ci.yml),
# and still in LTS (Node 20 reached end of life in April 2026).

# ---------- deps ----------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# Dev dependencies stay: they are copied into the runner below on purpose, because
# `tsx` (the worker, and any ops script run inside the container) is one of them.
RUN npm ci

# ---------- build ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Prisma CLI engine detection + query engine runtime need openssl (libssl3) here.
RUN apt-get update -qq && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# package.json "build" already runs prisma generate.
RUN npm run build

# ---------- runner (non-root) ----------
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Where uploaded files are written (src/server/services/files.ts reads UPLOAD_DIR).
# docker-compose.yml, and Coolify's persistent storage, must mount a volume at EXACTLY
# this path. The directory is created and owned by the runtime user so that the first
# mount of an empty named volume inherits write access for `zaki`.
ENV UPLOAD_DIR=/app/storage/uploads
# Prisma Client loads libquery_engine at runtime -> libssl3 must be present.
RUN apt-get update -qq && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --create-home --shell /bin/false zaki \
    && mkdir -p "$UPLOAD_DIR" \
    && chown -R zaki:zaki /app/storage

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
# `next start` reads next.config.mjs at runtime: without it the defaults apply and
# the boot-time environment check (src/instrumentation.ts) never runs.
COPY --from=build /app/next.config.mjs ./next.config.mjs
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/src ./src
# The worker (docker-compose.yml `worker` service) and operator scripts run with tsx,
# which needs the TypeScript config for the "@/..." import alias.
COPY --from=build /app/worker ./worker
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/tsconfig.json ./tsconfig.json

USER zaki
EXPOSE 3000
# bookworm-slim has no wget/curl; use node for the healthcheck.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health',r=>process.exit(r.statusCode<400?0:1)).on('error',()=>process.exit(1))"
# Apply additive-only, idempotent migrations at container start (requires
# DATABASE_URL from the environment — never baked into the image), then serve.
CMD ["sh", "-c", "npx prisma migrate deploy && exec npm start"]
