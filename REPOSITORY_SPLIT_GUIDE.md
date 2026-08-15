# Repository Split Guide — one repo per service

How to split this monorepo into two independent Git repositories (`frontend` and
`backend`) later, when repo names, URLs and domain are decided. **Nothing here is
executed now** — no remote repos, no pushes, no Coolify. This is the runbook.

> Prerequisite already satisfied by this preparation step: each service has its
> own `package-lock.json`, its own `Dockerfile`, its own `.dockerignore`, its own
> `.env.example`, and no import crosses the `frontend/` ↔ `backend/` boundary.

## 1. Target structure of each future repo

### `comunicacaoai-frontend` (from `frontend/`)
```
.
├── src/
├── public/
├── index.html
├── package.json
├── package-lock.json      # independent lock (already generated)
├── tsconfig*.json
├── vite.config.ts
├── Dockerfile
├── .dockerignore
├── nginx.conf
├── .env.example
└── .gitignore
```

### `comunicacaoai-backend` (from `backend/`)

> One repository, **one runtime service**: the API also runs the automation engine
> (scheduler + run queue) on MongoDB, so there is no broker and no second process
> to wire. `npm run start:worker` still exists for installs that prefer a dedicated
> worker (`EMBEDDED_WORKER=false`), but it is not part of the standard deploy —
> see `COOLIFY_DEPLOYMENT.md`.
```
.
├── src/
├── package.json
├── package-lock.json      # independent lock (already generated)
├── tsconfig.json
├── Dockerfile
├── .dockerignore
├── .env.example
└── .gitignore
```

## 2. Root files: copy, recreate, or drop

| Root file | Frontend repo | Backend repo | Notes |
|---|---|---|---|
| `package.json` (workspaces) | — | — | Monorepo-only; **not** copied. Each service already has its own. |
| root `package-lock.json` | — | — | Superseded by each service's own lock. |
| root `.gitignore` | recreate | recreate | Each service already ships its own `.gitignore`; keep it. |
| `README.md` | new, per service | new, per service | Split the relevant sections. |
| `compose.production-test.yml` | optional | optional | A cross-service harness. Keep a copy in **one** repo (or a small third "ops" repo) that builds the two images by git context; it is not needed inside either service to run. |
| `DEPLOYMENT_*.md`, this guide | reference copy | reference copy | Docs — copy wherever most useful. |
| `.claude/`, plans | — | — | Local tooling; do not publish. |

Each service is already self-contained: no `tsconfig` `extends` points outside
its folder, and no runtime dependency lives only in the root `package.json`
(the root has only `concurrently`, a dev-only convenience never used in prod).

## 3. Two ways to create each repo

### Option A — clean start (simplest, drops history)
```bash
# frontend
mkdir ../comunicacaoai-frontend && cp -R frontend/. ../comunicacaoai-frontend/
cd ../comunicacaoai-frontend && git init && git add . && git commit -m "chore: import frontend from monorepo"
# backend: same with backend/
```
Use this if history per-file is not important. Fastest, zero risk of leaking
monorepo history.

### Option B — preserve history with `git subtree split`
Keeps each service's commit history, authorship and dates.
```bash
# from the monorepo root, on a clean tree:
git subtree split --prefix=frontend -b split-frontend
git subtree split --prefix=backend  -b split-backend

# then push each branch to its own empty remote (later, when remotes exist):
#   git push git@github.com:<org>/comunicacaoai-frontend.git split-frontend:main
#   git push git@github.com:<org>/comunicacaoai-backend.git  split-backend:main
```
`git subtree split` rewrites only the selected prefix into a new root; authorship
and commit dates are preserved.

### Option C — preserve history with `git filter-repo` (most control)
```bash
# work on a CLONE, never the original:
git clone . ../fe-tmp && cd ../fe-tmp
git filter-repo --path frontend/ --path-rename frontend/:
# result: a repo whose root IS the old frontend/ subtree, full history retained.
```
`git filter-repo` (install separately) is preferred over the deprecated
`filter-branch`; it is faster and safer. Use a fresh clone so the original
monorepo is never mutated.

**Authorship/history:** both B and C preserve author name/email and dates. Verify
after splitting with `git log --format='%an %ae %ad' | head`.

## 4. Verify no secret enters either history

Before creating any remote or pushing:
```bash
# 1. Confirm no committed .env anywhere in history (should print nothing):
git log --all --diff-filter=A --name-only --pretty=format: | grep -E '(^|/)\.env($|\.)' | grep -v '\.env\.example' || echo "clean"

# 2. Scan the working tree + history for obvious secrets with a scanner, e.g.:
#    gitleaks detect --source . --no-banner
#    trufflehog git file://. 
```
`.env` and `.env.*` (except `.env.example`) are git-ignored in every service, so
a clean monorepo history should already be secret-free. Re-run the scan on each
split repo before its first push.

## 5. Branches (configure later, per repo)
- `main` — production; deploys the production Coolify resource.
- `development` — integration; optional preview resource.
Mirror the current monorepo convention (work on `development`, promote to `main`).

## 6. Wire each repo to its own Coolify resource (later)
- One Coolify **application per repo**, each pointing at its repo + branch.
- Frontend resource: build from repo root `Dockerfile`, set build arg
  `VITE_API_URL=https://api.comunicacaoai.oneplataforma.com`; expose the container's `8080`.
- Backend resource: build from repo root `Dockerfile`; expose `4000`; set all
  runtime env from the matrix; health check `GET /api/ready`.
- Frontend and backend share the registrable domain `oneplataforma.com`
  (`comunicacaoai.oneplataforma.com` / `api.comunicacaoai.oneplataforma.com`), so they
  are **same-site** and cookies stay simple (see report §cookies).

## 7. Coordinating contract changes across two repos
Once split, a change touching both sides (new API field, new socket event) spans
two PRs. To avoid breaking a live deploy:
- **Expand → migrate → contract.** Ship the backend change first in a
  backward-compatible way (add the new field/route; keep the old one), deploy,
  then update and deploy the frontend, then remove the old path in a later
  backend release.
- **Never** deploy a breaking backend and its frontend as a hard cutover — the
  two resources deploy independently and will briefly run mismatched versions.

## 8. API versioning / compatibility during independent deploys
- Keep additive changes backward-compatible; the frontend must tolerate an
  older-or-newer backend during the rollout window.
- If a breaking change is unavoidable, version the route (`/api/v2/...`) and
  serve both until the frontend has fully migrated.
- CORS/allowlist and Better Auth `trustedOrigins` are driven by `CLIENT_URL` —
  update it (and redeploy the backend) before switching the frontend's domain.

## 9. Independent rollback
- Each service rolls back on its own (redeploy the previous image/commit in its
  Coolify resource) without touching the other.
- Because deploys are decoupled, always keep the **previous** image tag available
  per service so a bad frontend deploy can revert while the backend stays put,
  and vice-versa.

## 10. Independence check BEFORE trusting the split
Copy each service OUT of the monorepo and prove it builds with nothing from the
root (this is exactly what the deployment-readiness testing does):
```bash
tmp=$(mktemp -d)
cp -R frontend "$tmp/frontend" && cd "$tmp/frontend"
npm ci && npm run build            # + npm test / npm run lint where present
docker build -t comunicacaoai-frontend:test .   # (when a Docker daemon is available)

cp -R backend "$tmp/backend" && cd "$tmp/backend"
npm ci && npm run build
docker build -t comunicacaoai-backend:test .
```
Neither may reference a file in the original repo root. If any step needs a root
file, fix the service to include it **before** creating the remote repos.
