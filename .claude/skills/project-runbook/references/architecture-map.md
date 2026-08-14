# Architecture map

Two npm workspaces under one root `package.json` (`workspaces: [frontend, backend]`). Node/Express/
MongoDB backend + Vite/React frontend. The **agent** is the primary unit of work; "Automação" is not a
product surface — scheduled work lives inside agents as Rotinas, running on the same engine.

## `backend/`

Express + MongoDB + BullMQ. The API and the worker are separate processes sharing this codebase.

| Path | Owns |
|---|---|
| `src/index.ts` | Express app: all HTTP routes, Socket.IO, startup (indexes, migrations) |
| `src/worker.ts` | Separate BullMQ process: run worker + schedule reconciler |
| `src/agents.ts` | Agent schema (agent-as-primary-unit fields), CRUD, `withAgentDefaults` |
| `src/agentPresets.ts` | Role-preset catalog + `suggestPresetForCapability` |
| `src/agentRuntime.ts` | Non-conversational task runtime (`executeAgentTask`) |
| `src/agentTools.ts`, `src/builtinTools.ts` | Tool resolution funnel (`resolveAgentTools`) |
| `src/delegation.ts` | IO-free delegation gate + tools (owner/building/depth/cycle/budget/cancel) |
| `src/delegationWiring.ts`, `src/delegationLog.ts` | Real delegation deps + history collection |
| `src/automations/` | Definition-driven engine: `service`, `runService`, `runner`, `scheduler`, `queue`, `webhook`, `schedule` (friendly recurrence↔cron), `routine` (agent-owned automations), `validate` |
| `src/sectors.ts`, `src/sectorMembership.ts` | Sector teams (adaptive/pipeline), one sector per agent |
| `src/floors.ts`, `src/offices.ts`, `src/building.ts` | Andar / Escritório / Prédio hierarchy |
| `src/routes/` | Route modules mounted by `index.ts` (e.g. `agentRoutineRoutes`) |
| `src/connections/` | Delivery connections (email/telegram) + adapters |
| `src/llm.ts`, `src/claude.ts`, `src/openai.ts` | Provider dispatch (Anthropic/OpenAI), shared by chat + tasks |
| `src/knowledge.ts`, `src/voyage.ts` | Per-agent knowledge base + embeddings |
| `src/widgets.ts`, `src/whatsapp.ts` | Public chat widget + WhatsApp channel |
| `test/*.test.mjs` | Pure node:test suites over `dist/` (dummy `MONGODB_URI`, injected deps) |

MongoDB is the source of truth; BullMQ only coordinates jobs. Everything is owner-scoped
(`ownerId` + `buildingId`/`floorId`) — never trust ids across owners.

## `frontend/`

Vite + React + TypeScript. Feature flags in `src/featureFlags.ts` gate the AI-building pivot (all
default OFF via `VITE_*` env).

| Path | Owns |
|---|---|
| `src/App.tsx` | Route tree (v2 floor-scoped + legacy redirects, gated by `aiBuilding`) |
| `src/pages/` | Screens: `Agents`, `AgentDetail`, `Setores`, `SectorDetail`, `FloorView`, `Widgets`, `Chats`, `Settings`, `redirects` |
| `src/components/` | `AgentForm`, `HireWizard` (8-step hiring), `AgentWorkAreas` (Rotinas/Acionamentos/Histórico), `Sidebar`, `MobileNav`, `navConfig`/`navItems` |
| `src/office/` | Office-map layout + illustrations (desks, rooms, agents) |
| `src/ui/` | Design-system primitives (`Button`, `Card`, `Field`, `Input`, `Select`, `StatusPill`, `Dialog`, …) — import from `../ui` |
| `src/lib/` | Typed fetch clients + hooks (`agentRoutines`, `agentPresets`, `sectors`, `floorRoutes`, `types`, `useAgentsAndWidgets`) |
| `src/contexts/` | `BuildingContext` (active floor/building) |
| `e2e/` | Playwright specs (guarded) |

Visible copy is written in **pt-BR directly in the components** (no i18n locale layer). Code,
comments, and commits are in English.
