---
name: execute-plan-task
description: Execute exactly one task from IMPLEMENTATION_PLAN.md by its ID (for example P3-T2). Loads a bounded task packet instead of the whole plan, implements the task, verifies it, records the decision, and only then marks it complete. Use whenever the user asks to work on, continue, resume, or verify a numbered plan task, or says "next task".
---

# execute-plan-task

Normal entrypoint for implementation work. One invocation owns exactly one task.

## 1. Load the packet

```bash
node .claude/skills/execute-plan-task/scripts/extract-plan-task.mjs <TASK-ID>
```

The script is read-only. It prints the task, its phase heading, the phase checkpoint, and any
architecture section the task names. Do not read `IMPLEMENTATION_PLAN.md` in full — if the packet
is missing context, read only the extra section you actually need.

Exit codes: `1` usage, `2` unknown task ID, `3` duplicate task ID. Fix the plan before retrying `3`.

## 2. Execute

1. Read the existing code the task touches before editing it.
2. Mark **only that task** `[~]` in `IMPLEMENTATION_PLAN.md`.
3. Implement the smallest change that satisfies the acceptance criteria. No unrelated refactors.
4. Add or update tests in the same task.
5. Any user-facing copy change updates both `frontend/src/i18n/locales/pt-BR/` and `en-US/`. Never
   hardcode a visible string.
6. Run the task's own `Verify:` command, then the impacted workspace `typecheck` and `build`.
7. Fix every failure the task caused.

## 3. Close the task

Only when verification passes:

- Change `[~]` to `[x]`.
- Append one line to the Progress Log table (Section 15): date, task, result, verification.
- Append to the Decision Log (Section 14) only for a real deviation from the plan, with the reason.
- Continue to the next unblocked task.

Never mark `[x]` while typecheck, tests, or build fail. When genuinely blocked by a missing
credential, a service the user must configure, or an irreversible decision, mark `[!]`, record the
exact blocker, and move to another task only if that cannot hide or worsen the blocker.
