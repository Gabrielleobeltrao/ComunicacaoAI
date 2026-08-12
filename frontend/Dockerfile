# Frontend production image — multi-stage. Build context is THIS folder only:
#   docker build -t comunicacaoai-frontend:test --build-arg VITE_API_URL=https://api.example.invalid frontend
#
# VITE_API_URL is a BUILD arg: Vite inlines it into the browser bundle, so it is
# public by definition — never pass a secret here.

# --- build stage ---------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Install deps first (cache-friendly): needs frontend/package-lock.json.
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_API_URL=https://api.example.invalid
ENV VITE_API_URL=${VITE_API_URL}
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
