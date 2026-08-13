# Frontend production image — multi-stage. Build context is THIS folder only:
#   docker build -t comunicacaoai-frontend:test --build-arg VITE_API_URL=https://api.comunicacaoai.oneplataforma.com frontend
#
# VITE_API_URL is a BUILD arg: Vite inlines it into the browser bundle, so it is
# public by definition — never pass a secret here.

# --- build stage ---------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Install deps first (cache-friendly): needs frontend/package-lock.json.
COPY package.json package-lock.json ./
# --include=dev: the build needs devDependencies (vite, typescript) even when the
# platform injects NODE_ENV=production at build time.
RUN npm ci --include=dev
COPY . .
# Default points at the production backend origin; override per environment.
ARG VITE_API_URL=https://api.comunicacaoai.oneplataforma.com
ENV VITE_API_URL=${VITE_API_URL}
# Public AI feature flags (build-time — Vite inlines VITE_* into the bundle, so a
# runtime env in Coolify does NOT change an already-built bundle). Defaults match
# the validated app UX (nav V2 on); set these as BUILD variables in Coolify. None
# is a secret. See frontend/.env.production.example.
ARG VITE_AI_BUILDING_ENABLED=true
ARG VITE_AI_FLOORS_ENABLED=false
ARG VITE_AI_AUTOMATIONS_ENABLED=true
ARG VITE_AI_SCHEDULER_ENABLED=true
ARG VITE_AI_DELIVERIES_ENABLED=true
ARG VITE_AI_OFFICE_LIVE_STATUS_ENABLED=true
ENV VITE_AI_BUILDING_ENABLED=${VITE_AI_BUILDING_ENABLED} \
    VITE_AI_FLOORS_ENABLED=${VITE_AI_FLOORS_ENABLED} \
    VITE_AI_AUTOMATIONS_ENABLED=${VITE_AI_AUTOMATIONS_ENABLED} \
    VITE_AI_SCHEDULER_ENABLED=${VITE_AI_SCHEDULER_ENABLED} \
    VITE_AI_DELIVERIES_ENABLED=${VITE_AI_DELIVERIES_ENABLED} \
    VITE_AI_OFFICE_LIVE_STATUS_ENABLED=${VITE_AI_OFFICE_LIVE_STATUS_ENABLED}
RUN npm run build

# --- runtime stage -------------------------------------------------------------
# Unprivileged nginx: runs as a non-root user and listens on 8080 by default.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
# Static SPA + widget assets.
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
# HEALTHCHECK omitted here: the alpine image has no curl/wget guaranteed; the
# orchestrator should hit GET /healthz (see nginx.conf). Add one only once tested.
