# Backend production image — multi-stage. Build context is THIS folder only:
#   docker build -t comunicacaoai-backend:test backend
#
# ONE image, TWO production services (override the command per service):
#   API    -> npm run start:api      (HTTP, port 4000)
#   worker -> npm run start:worker   (automation runs + scheduler, no HTTP)
# The default CMD below is the API, so a platform that ignores the command still
# serves traffic — but a deploy WITHOUT the worker never executes a routine. See
# COOLIFY_DEPLOYMENT.md. Never run both in one container via `concurrently`.
#
# No real secrets are baked in: MONGODB_URI, BETTER_AUTH_SECRET, ENCRYPTION_KEY,
# provider keys, etc. are all injected at RUN time by the orchestrator.

# --- build stage ---------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Install deps first (cache-friendly): needs backend/package-lock.json.
COPY package.json package-lock.json ./
# --include=dev: the build needs devDependencies (typescript) even when the
# platform injects NODE_ENV=production at build time, which would otherwise make
# npm omit them and break `tsc`.
RUN npm ci --include=dev
COPY . .
# Compile TypeScript (src -> dist).
RUN npm run build

# --- deps stage (production node_modules only) ---------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- app stage (shared layers, no command) -------------------------------------
# Everything both processes need. The two stages below differ ONLY in which
# process they start, so the API and the worker really are the same image.
FROM node:22-bookworm-slim AS app
ENV NODE_ENV=production
WORKDIR /app
# Production dependencies + compiled output + package metadata only. No source,
# no dev dependencies, no TypeScript toolchain.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# O npm SAI da imagem de produção.
#
# Ele vem embutido na base do Node e nunca é usado aqui: o processo é iniciado por
# `node dist/*.js`, e as dependências já chegaram prontas do estágio `deps`. O que fica
# é a árvore de dependências do PRÓPRIO npm — tar, pacote, sigstore, brace-expansion — e
# é exatamente ela que o scanner de imagem reprova, sem que nada disso rode em produção.
#
# Tirar é melhor que silenciar o aviso: um contêiner de produção com gerenciador de
# pacote dentro é uma ferramenta pronta para quem conseguir executar código nele.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# Drop privileges: the official node image ships a non-root `node` user (uid 1000).
USER node

# --- worker stage --------------------------------------------------------------
# For platforms whose UI cannot override the container command: build with
# `--target worker` (Coolify: "Docker Build Stage Target" = worker) and the image
# starts the automation worker instead of the API. Equivalent to overriding the
# command with `node dist/worker.js` — e não com `npm run start:worker`: esta imagem
# não tem npm (ver acima).
FROM app AS worker
CMD ["node", "dist/worker.js"]

# --- runtime stage (LAST on purpose = the default target) ----------------------
# Building without an explicit target yields the API, so the existing API service
# keeps working with no configuration change.
FROM app AS runtime
# Internal port only; the orchestrator maps/proxies it. Kept in sync with PORT.
EXPOSE 4000
# Exec form so Node is the signal target and receives SIGTERM directly (the app
# installs SIGTERM/SIGINT handlers for graceful shutdown). Run the orchestrator/
# compose with init:true for PID-1 reaping. No watcher in production.
# Default = API. O serviço do worker sobrescreve com `node dist/worker.js`.
CMD ["node", "dist/index.js"]
# HEALTHCHECK is defined at the orchestration layer (compose/Coolify) hitting
# GET /api/ready — this slim image has no guaranteed curl/wget to script one here.
