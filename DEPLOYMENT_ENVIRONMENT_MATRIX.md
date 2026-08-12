# Deployment Environment Matrix

Authoritative list of every environment variable the two services actually read
(verified from source: `import.meta.env.*` in `frontend/src`, `process.env.*` in
`backend/src`). No variable is listed that the code does not consume.

**Example values use the reserved `.invalid` TLD and are never real.** Real
values are supplied at deploy time and never committed.

## Legend

- **Build-time**: read while building the image; for the frontend it is inlined
  into the browser bundle and is therefore **public**.
- **Runtime**: read by the running container; backend secrets are runtime-only
  and never reach the browser.
- **Required (prod)**: `NODE_ENV=production` startup **fails fast** if missing.
  In development/test the app falls back to a localhost default.

## Frontend (`frontend/`)

| Variable | Service | Required | Phase | Sensitivity | Safe example (`.invalid`) | Source of value | Rotate when | If missing |
|---|---|---|---|---|---|---|---|---|
| `VITE_API_URL` | frontend | Required | **Build-time** | **Public** (inlined in bundle) | `https://api.example.invalid` | Backend public origin | Backend domain changes | API calls have no base URL → app cannot reach the backend |

> `VITE_API_URL` is passed as a Docker `--build-arg`. Because Vite inlines it into
> the bundle, it is public by definition — **never** put a secret in a `VITE_*` var.

## Backend (`backend/`)

| Variable | Service | Required | Phase | Sensitivity | Safe example (`.invalid`) | Source of value | Rotate when | If missing |
|---|---|---|---|---|---|---|---|---|
| `NODE_ENV` | backend | Required (prod) | Runtime | Public | `production` | Deploy config | n/a | No fail-fast validation; cookies not marked Secure/SameSite=None |
| `PORT` | backend | Optional (default `4000`) | Runtime | Public | `4000` | Deploy config | n/a | Defaults to `4000` |
| `CLIENT_URL` | backend | Required (prod) | Runtime | Public | `https://app.example.invalid` | Frontend public origin(s), comma-separated | Frontend domain changes | Startup fails in prod; CORS + Socket.IO + cookies reject the frontend |
| `BETTER_AUTH_URL` | backend | Required (prod) | Runtime | Public | `https://api.example.invalid` | Backend public origin | Backend domain changes | Startup fails; auth base + Google callback wrong |
| `PUBLIC_URL` | backend | Required (prod) | Runtime | Public | `https://api.example.invalid` | Backend public origin | Backend domain changes | Startup fails; WhatsApp webhook URLs are wrong |
| `MONGODB_URI` | backend | **Required** | Runtime | **Secret** | `mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/comunicacaoai` | MongoDB Atlas | DB credential suspected leaked / policy rotation | Startup fails; no persistence |
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
| `GOOGLE_REDIRECT_URI` | backend | Optional | Runtime | Public | `https://api.example.invalid/api/integrations/google/callback` | Derived from `BETTER_AUTH_URL` if unset | Backend domain changes | Defaults to `BETTER_AUTH_URL` + `/api/integrations/google/callback` |

## Credentials that are **not** environment variables

WhatsApp / Meta / Twilio channel credentials are **not** read from the
environment. They are entered per channel in the app and stored **encrypted in
MongoDB** (using `ENCRYPTION_KEY`). There is therefore no `TWILIO_*` / `META_*`
env var to configure at the platform level — do not invent one.

## `BETTER_AUTH_SECRET` vs `ENCRYPTION_KEY`

They are **different secrets with different blast radii** and must not be reused:

- `BETTER_AUTH_SECRET` signs auth/session cookies. Rotating it logs everyone out
  but loses no stored data.
- `ENCRYPTION_KEY` encrypts secrets at rest in the database. Rotating it makes
  previously stored secrets undecryptable unless they are re-encrypted first —
  treat rotation as a data-migration, not a config flip.

## Values still pending the final URLs

`VITE_API_URL`, `CLIENT_URL`, `BETTER_AUTH_URL`, `PUBLIC_URL` and (if Google is
enabled) `GOOGLE_REDIRECT_URI` all resolve only once the real frontend/backend
domains are chosen. Until then they stay as `.invalid` placeholders. See the
cookie decision note in `DEPLOYMENT_READINESS_REPORT.md`.
