# Deployment Environment Matrix

Authoritative list of every environment variable the services actually read
(verified from source: `import.meta.env.*` in `frontend/src`, `process.env.*` in
`backend/src`). No variable is listed that the code does not consume.

**Production runs TWO resources** (see `COOLIFY_DEPLOYMENT.md`): frontend and
backend. The automation engine — the scheduler and the run queue — lives INSIDE the
backend process and stores everything in MongoDB, so there is no broker and no
separate worker to forget. An earlier design used a private Redis plus a dedicated
worker; it was removed after a deploy that created only the API left every
scheduled routine silently unexecuted.

**Definitive production origins (ASCII, no trailing slash):**

- Frontend: `https://comunicacaoai.onplataform.com`
- Backend: `https://api.comunicacaoai.onplataform.com`

Secrets are never real in this repo. URLs are public and are the real values above.

## Legend

- **Build-time**: read while building the image; for the frontend it is inlined
  into the browser bundle and is therefore **public**.
- **Runtime**: read by the running container; backend secrets are runtime-only
  and never reach the browser.
- **Required (prod)**: `NODE_ENV=production` startup **fails fast** if missing.
  In development/test the app falls back to a localhost default.

## Frontend (`frontend/`)

| Variable | Service | Required | Phase | Sensitivity | Example | Source of value | Rotate when | If missing |
|---|---|---|---|---|---|---|---|---|
| `VITE_API_URL` | frontend | Required | **Build-time** | **Public** (inlined in bundle) | `https://api.comunicacaoai.onplataform.com` | Backend public origin | Backend domain changes | API calls have no base URL → app cannot reach the backend |

> `VITE_API_URL` is passed as a Docker `--build-arg`. Because Vite inlines it into
> the bundle, it is public by definition — **never** put a secret in a `VITE_*` var.

## Backend (`backend/`)

| Variable | Service | Required | Phase | Sensitivity | Example | Source of value | Rotate when | If missing |
|---|---|---|---|---|---|---|---|---|
| `NODE_ENV` | backend | Required (prod) | Runtime | Public | `production` | Deploy config | n/a | No fail-fast validation; cookies not marked Secure/SameSite=None |
| `PORT` | backend | Optional (default `4000`) | Runtime | Public | `4000` | Deploy config | n/a | Defaults to `4000` |
| `CLIENT_URL` | backend | Required (prod) | Runtime | Public | `https://comunicacaoai.onplataform.com` | Frontend public origin(s), comma-separated | Frontend domain changes | Startup fails in prod; CORS + Socket.IO + cookies reject the frontend |
| `BETTER_AUTH_URL` | backend | Required (prod) | Runtime | Public | `https://api.comunicacaoai.onplataform.com` | Backend public origin | Backend domain changes | Startup fails; auth base + Google callback wrong |
| `PUBLIC_URL` | backend | Required (prod) | Runtime | Public | `https://api.comunicacaoai.onplataform.com` | Backend public origin | Backend domain changes | Startup fails; WhatsApp webhook URLs are wrong |
| `MONGODB_URI` | backend API + worker | **Required** | Runtime | **Secret** | `mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/comunicacaoai` | MongoDB Atlas | DB credential suspected leaked / policy rotation | Startup fails; no persistence |
| `EMBEDDED_WORKER` | backend | Optional (default `true`) | Runtime | Public | `true` | Deploy config | Splitting the worker out at scale | The automation engine runs inside the API. `false` disables it, and a separate `npm run start:worker` process must then exist |
| `WORKER_CONCURRENCY` | backend | Optional (default `4`) | Runtime | Public | `4` | Deploy config | Tuning throughput | Defaults to 4 concurrent runs |
| `RUN_POLL_MS` / `SCHEDULER_POLL_MS` | backend | Optional (`3000` / `15000`) | Runtime | Public | `3000` | Deploy config | Tuning latency vs. DB load | Routines fire within one scheduler tick |
| `RUN_LEASE_MS` / `MAX_RUN_CLAIMS` | backend | Optional (`600000` / `3`) | Runtime | Public | `600000` | Deploy config | Very long runs | A crashed instance's run is reclaimed after the lease; a run that keeps dying is parked as failed |
| `BETTER_AUTH_SECRET` | backend | Required (prod) | Runtime | **Secret** | `openssl rand -hex 32` | Generated, unique per env | Periodic / on suspicion (invalidates sessions) | Startup fails; session cookies cannot be signed |
| `ENCRYPTION_KEY` | backend | Required (prod) | Runtime | **Secret** | `openssl rand -hex 32` | Generated, unique per env | Rare — rotating requires re-encrypting stored secrets | Startup fails; stored provider/integration secrets cannot be decrypted |
| `ANTHROPIC_API_KEY` | backend | Optional | Runtime | **Secret** | *(blank)* | Anthropic Console | Provider policy / on suspicion | Anthropic RAG replies unavailable (per-account keys still work) |
| `ANTHROPIC_MODEL` | backend | Optional | Runtime | Public | `claude-sonnet-5` | Fixed config | Model change | Uses built-in default |
| `ANTHROPIC_AUX_MODEL` | backend | Optional | Runtime | Public | *(blank)* | Fixed config | Model change | Falls back to primary model |
| `OPENAI_API_KEY` | backend | Optional | Runtime | **Secret** | *(blank)* | OpenAI Dashboard | Provider policy / on suspicion | OpenAI RAG replies unavailable (per-account keys still work) |
| `OPENAI_MODEL` | backend | Optional | Runtime | Public | `gpt-5.1` | Fixed config | Model change | Uses built-in default |
| `OPENAI_AUX_MODEL` | backend | Optional | Runtime | Public | *(blank)* | Fixed config | Model change | Falls back to primary model |
| `VOYAGE_API_KEY` | backend | Optional | Runtime | **Secret** | *(blank)* | Voyage AI | Provider policy / on suspicion | Voyage embeddings unavailable |
| `VOYAGE_MODEL` | backend | Optional | Runtime | Public | `voyage-4` | Fixed config | Model change | Uses built-in default |
| `GOOGLE_CLIENT_ID` | backend | Optional | Runtime | Secret-ish | *(blank)* | Google Cloud OAuth client | Provider policy | Google Calendar integration hidden |
| `GOOGLE_CLIENT_SECRET` | backend | Optional | Runtime | **Secret** | *(blank)* | Google Cloud OAuth client | Provider policy / on suspicion | Google OAuth callback fails |
| `GOOGLE_REDIRECT_URI` | backend | Optional | Runtime | Public | `https://api.comunicacaoai.onplataform.com/api/integrations/google/callback` | Derived from `BETTER_AUTH_URL` if unset | Backend domain changes | Defaults to `BETTER_AUTH_URL` + `/api/integrations/google/callback` |
| `RESOURCE_PLATFORM_ENABLED` | backend | Optional (default on) | Runtime | Public | *(unset)* | Deploy config | Rolling the resource layer back | `0` makes `/api/resources` answer 404 — the route is closed, not just the button |
| `DATABASES_ENABLED` | backend | Optional (default on) | Runtime | Public | *(unset)* | Deploy config | Rolling Databases back | `0` makes `/api/databases` answer 404 |
| `MONITORS_ENABLED` | backend | Optional (default on) | Runtime | Public | *(unset)* | Deploy config | Rolling Monitors back | `0` makes `/api/monitors` answer 404. Monitors already published keep their state; nothing is deleted |
| `COMMUNITY_MARKETPLACE_ENABLED` | backend | Optional (default on) | Runtime | Public | *(unset)* | Deploy config | Closing the community catalog | `0` makes the catalog and community installs answer 404. Creating and publishing your OWN packages stays open — it needs no community |
| `CODE_TOOLS_ENABLED` | backend | Optional (**default off**) | Runtime | Public | *(unset)* | Deploy config | Only when a real isolated runner exists | Anything other than `1` keeps code tools unpublishable and unexecutable. **Setting it to `1` is not enough**: the gate also requires a registered `SandboxRuntimeProvider` whose `health()` proves non-root, read-only rootfs, denied network, no-new-privileges, seccomp, ephemeral env and verified cleanup. No such provider ships in this repository, so code stays off |
| `SANDBOX_RUNNER_URL` | backend | Optional | Runtime | Public | `http://sandbox-runner:4300` | Deploy config — **never a request** | Runner moves | Without it (or the secret) no provider is registered and code stays fail-closed |
| `SANDBOX_RUNNER_SECRET` | backend + runner | Required to run code | Runtime | **Secret** | `openssl rand -hex 32` | Generated, shared by the pair | On suspicion | The runner answers 503 to everyone; a runner without a secret is worse than no runner |
| `SANDBOX_RUNNER_TIMEOUT_MS` | backend | Optional (`20000`) | Runtime | Public | `20000` | Deploy config | Slow runners | The backend cuts a call at 20s; the runner has its own cap and the smaller one wins |
| `PLATFORM_REVIEWERS` | backend | Optional (**default empty**) | Runtime | Public | `<accountId>,<accountId>` | Deploy config — **never the request body** | Team changes | Nobody can review, so code cannot be published. That is the default |
| `SANDBOX_EPHEMERAL` / `SANDBOX_NO_NEW_PRIVILEGES` / `SANDBOX_SECCOMP` | runner | Optional (default off) | Runtime | Public | `1` | Deploy config, matching what the orchestrator really applies | Deployment changes | The measured profile reports them false, and the backend refuses to enable code. See `SANDBOX_RUNBOOK.md` |
| `SANDBOX_CONCURRENCY` | runner | Optional (`1`) | Runtime | Public | `1` | Deploy config | Throughput | One execution at a time; above the cap the runner refuses instead of queueing |
| `SANDBOX_HANDLE_TTL_MS` / `SANDBOX_HANDLE_MAX_USES` | backend | Optional (`30000` / `5`) | Runtime | Public | `30000` | Deploy config | Tuning the capability broker | Capability handles live 30s and are good for at most 5 uses |
| `EXECUTOR_TOOL_TIMEOUT_MS` | backend | Optional (`30000`) | Runtime | Public | `30000` | Deploy config | Slow third-party APIs | A tool call is cut at 30s |

## `CLIENT_URL` vs `CLIENT_URLS`

The allowlist is carried by **`CLIENT_URL`**, which accepts a single origin or a
comma-separated list. A separate `CLIENT_URLS` variable is **not implemented** —
do not set it. Production uses exactly:

```
CLIENT_URL=https://comunicacaoai.onplataform.com
```

## Credentials that are **not** environment variables

WhatsApp / Meta / Twilio channel credentials are **not** read from the
environment. They are entered per channel in the app and stored **encrypted in
MongoDB** (using `ENCRYPTION_KEY`). There is therefore no `TWILIO_*` / `META_*`
env var to configure at the platform level — do not invent one.

The same is true of every **App** an owner connects (Slack, Mercado Pago, RD
Station, HubSpot, Stripe, Nuvemshop, a private App…). Their credentials are typed
in the product, encrypted with `ENCRYPTION_KEY` and stored on the installation —
never in the environment, never in the agent document, and never returned by the
API. Adding an App therefore adds **no** environment variable.

Google is the exception in shape only: the OAuth **client** is a platform
credential (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`), while the owner's own
tokens stay encrypted in the database.

## Collections the boot migration creates or evolves

`runMigrations()` runs on every boot, is idempotent and additive — it never
deletes and never changes behaviour an owner already had. It creates the indexes
for, and backfills:

| Collection | What it holds | Backfill |
| --- | --- | --- |
| `connections` | App installations (evolved from provider connections) | `appKey`/`appVersion`/`grantedScopes` filled from `provider` |
| `app_definitions` | Private App manifests | — |
| `user_navigation_preferences` | Pinned Apps, per user | — |
| `agent_live_states` | Ephemeral operational state (TTL index) | — |
| `sector_executions` | One root per sector run | — |
| `execution_roots` | One root per request | — |
| `app_action_events` | Safe App action telemetry | — |
| `agents` | — | credentials moved out of `builtinTools` into installations; `appGrants` written |
| `sectors` | — | `entryPolicy: 'open_members'` (current behaviour, unchanged) |
| `buildings` | — | `floorCommunication`: `all` for a multi-floor building, `isolated` for a single-floor one |
| `offices` (floors) | — | read as `workMode: 'organization'` (current behaviour) |
| `monitors` / `monitor_states` | Watch rules and their on-duty state | — (new; nothing is backfilled) |
| `tool_versions` / `tool_version_calls` | Frozen tool versions and safe call telemetry | — (legacy tools stay `http`/`0.0.0`, derived at read time) |
| `extension_packages` / `extension_versions` / `extension_installations` | Shareable packages, frozen versions, per-account installs | — (private Apps get a package only through the explicit `POST /api/extensions/backfill/apps`) |
| `sandbox_capability_handles` | Short-lived capability handles (TTL index); stores the token HASH, never the token | — |
| `sandbox_kill_switches` | Code disabled by package, version or hash | — |
| `extension_reviews` | Immutable review decisions, bound to (subject, hash, reviewer) | — (no update path exists by design) |
| `data_stores` / `dataset_definitions` | Databases and their datasets | — (existing histories are projected only by the explicit `POST /api/databases/migrate/histories`, which moves no records and has a rollback) |

Rolling back the application code is safe: the added fields are ignored by the
previous version, the legacy `builtinTools` entries are still present (stamped
`migratedAt`), and no collection was dropped or renamed.

## `BETTER_AUTH_SECRET` vs `ENCRYPTION_KEY`

They are **different secrets with different blast radii** and must not be reused:

- `BETTER_AUTH_SECRET` signs auth/session cookies. Rotating it logs everyone out
  but loses no stored data.
- `ENCRYPTION_KEY` encrypts secrets at rest in the database. Rotating it makes
  previously stored secrets undecryptable unless they are re-encrypted first —
  treat rotation as a data-migration, not a config flip.

## Definitive production values (URLs only; secrets generated at deploy)

```
# Contract (documentation names)
FRONTEND_PUBLIC_URL=https://comunicacaoai.onplataform.com
BACKEND_PUBLIC_URL=https://api.comunicacaoai.onplataform.com

# Frontend (build-time)
VITE_API_URL=https://api.comunicacaoai.onplataform.com

# Backend (runtime)
CLIENT_URL=https://comunicacaoai.onplataform.com
BETTER_AUTH_URL=https://api.comunicacaoai.onplataform.com
PUBLIC_URL=https://api.comunicacaoai.onplataform.com
GOOGLE_REDIRECT_URI=https://api.comunicacaoai.onplataform.com/api/integrations/google/callback
```

`comunicacaoai.onplataform.com` and `api.comunicacaoai.onplataform.com` share the
registrable domain `onplataform.com`, so they are **same-site** — see the cookie
note in `DEPLOYMENT_READINESS_REPORT.md`.
