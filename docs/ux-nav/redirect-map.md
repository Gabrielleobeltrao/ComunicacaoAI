# Navigation V2 — redirect map

Nav V2 is gated by `VITE_AI_BUILDING_ENABLED` (→ `featureFlags.aiBuilding`). When
**on**, the URL is the source of truth for the active floor and every module lives
under a canonical floor-scoped path. Old flat bookmarks keep working: they resolve
the active floor (URL → `localStorage` → first active floor) and `<Navigate replace>`
into the canonical route.

## Canonical routes (V2)

| Route | Page | Scope |
|---|---|---|
| `/dashboard` | **Resolver** → the active floor (`/floors/:active`). The building overview was merged into the floor home; only when the account has no floor yet does it render the building landing (KPIs + create-first-floor). | building |
| `/floors/:floorId` | **Floor home**: building summary strip (KPIs) + the floor's visual office map + floor data. This is the app home. | floor |
| `/floors/:floorId/agents` | Agents of the floor | floor |
| `/floors/:floorId/agents/:agentId[/:section]` | Agent detail | floor |
| `/floors/:floorId/sectors` | Sectors of the floor | floor |
| `/floors/:floorId/sectors/:sectorId[/:section]` | Sector detail | floor |
| `/floors/:floorId/automations` | Automations of the floor | floor |
| `/floors/:floorId/automations/:id` | Automation editor | floor |
| `/floors/:floorId/runs` | Runs of the floor | floor |
| `/widgets`, `/chats` | Channels / Conversations | communication |

## Legacy → canonical

| Legacy path | Redirects to | Component |
|---|---|---|
| `/building` | `/dashboard` | `BuildingToDashboard` |
| `/agents` | `/floors/:active/agents` | `LegacyModuleRedirect module="agents"` |
| `/setores` | `/floors/:active/sectors` | `LegacyModuleRedirect module="sectors"` |
| `/automations` | `/floors/:active/automations` | `LegacyModuleRedirect module="automations"` |
| `/runs` | `/floors/:active/runs` | `LegacyModuleRedirect module="runs"` |
| `/automations/:id` | `/floors/:floorId/automations/:id` | `AutomationDetailRedirect` (resolves the automation's real floor) |

`:active` = the resolved active floor. Detail routes that already carry their own id
(`/agents/:agentId`, `/setores/:sectorId`) render in place — the entity's floor is
authoritative, so there is nothing to redirect.

## Rollback

Set `VITE_AI_BUILDING_ENABLED=false` (or unset it) and rebuild the frontend. The app
falls back to the original flat routes and the V1 sidebar/dashboard **unchanged** —
the V2 shell, floor-scoped routes and redirects are all behind the single flag.
