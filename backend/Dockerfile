# Backend production image — multi-stage. Build context is THIS folder only:
#   docker build -t comunicacaoai-backend:test backend
#
# No real secrets are baked in: MONGODB_URI, BETTER_AUTH_SECRET, ENCRYPTION_KEY,
# provider keys, etc. are all injected at RUN time by the orchestrator.

# --- build stage ---------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Install deps first (cache-friendly): needs backend/package-lock.json.
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Compile TypeScript (src -> dist).
RUN npm run build

# --- deps stage (production node_modules only) ---------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- runtime stage -------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Production dependencies + compiled output + package metadata only. No source,
# no dev dependencies, no TypeScript toolchain.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# Drop privileges: the official node image ships a non-root `node` user (uid 1000).
USER node
# Internal port only; the orchestrator maps/proxies it. Kept in sync with PORT.
EXPOSE 4000
# Exec form so Node is the signal target and receives SIGTERM directly (the app
# installs SIGTERM/SIGINT handlers for graceful shutdown). Run the orchestrator/
# compose with init:true for PID-1 reaping. No watcher in production.
CMD ["node", "dist/index.js"]
# HEALTHCHECK is defined at the orchestration layer (compose/Coolify) hitting
# GET /api/ready — this slim image has no guaranteed curl/wget to script one here.
