# syntax=docker/dockerfile:1

# Debian bookworm-slim instead of alpine:
# Prisma 5.x engines need OpenSSL shared libs; Debian provides libssl3 (openssl 3.x)
# reliably, avoiding the "libssl.so.1.1: No such file or directory" musl/openssl
# detection failures seen on node:20-alpine.

# ---------- deps ----------
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# ---------- build ----------
FROM node:20-bookworm-slim AS build
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
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Prisma Client loads libquery_engine at runtime -> libssl3 must be present.
RUN apt-get update -qq && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --create-home --shell /bin/false zaki

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
# NOTE: this repo has no public/ directory (not tracked by git) -> do NOT copy it.
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/src ./src

USER zaki
EXPOSE 3000
# bookworm-slim has no wget/curl; use node for the healthcheck.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health',r=>process.exit(r.statusCode<400?0:1)).on('error',()=>process.exit(1))"
# Apply additive-only, idempotent migrations at container start (requires
# DATABASE_URL from the environment — never baked into the image), then serve.
CMD ["sh", "-c", "npx prisma migrate deploy && exec npm start"]
