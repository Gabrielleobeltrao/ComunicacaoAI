# Definition of done

A change is finished only when all of the following hold for every workspace it touches.

## Quality gates

- **Backend**: `npx tsc --noEmit` clean, `npm run build -w backend` clean, and `npm test -w backend`
  green (build first — tests run over `dist/`).
- **Frontend**: `npx tsc -b --noEmit` clean, `npm run lint -w frontend` with **0 errors**,
  `npm run build -w frontend` clean, and `npm test -w frontend` green.
- Non-trivial logic ships with a test in the same change. Backend tests stay IO-free (dummy
  `MONGODB_URI`, injected deps); prefer pure functions so they need no DB/provider.

## Correctness & scope

- Additive by default: new fields get safe defaults so legacy documents keep working
  (`withAgentDefaults` pattern). No destructive migrations without an explicit ask.
- Owner-scoped always: filter by `ownerId` (+ `buildingId`/`floorId`); never trust ids across owners.
- Fix the root cause in the shared function, not per-caller symptoms.
- No new product surface for "Automação" — scheduled work belongs to an agent (Rotina).

## Conventions

- User-facing copy is **pt-BR, written inline** in the component (no i18n locale layer).
- Code, comments, commit messages, and docs are in **English**.
- Delegation / any agent action must have a **real executor** — never a trigger without one.

## Workflow

- Work stays on the **`development`** branch. Push to `main` only when explicitly asked.
- Don't deploy or touch secrets as a side effect of a feature.
- Commit only when asked; end commit messages with the
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.
