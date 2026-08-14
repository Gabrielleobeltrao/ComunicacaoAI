---
name: project-runbook
description: Concise routing to this project's architecture map, canonical commands, and definition of done. Use when you need to know where a module lives, which command to run, or whether a change is finished — instead of browsing the repository.
---

# project-runbook

Read **one** reference file, chosen by the question. Do not read all three.

| Question | File |
|---|---|
| Where does this live? Which workspace owns it? What may import what? | `references/architecture-map.md` |
| How do I install, run, test, typecheck, build, or verify? | `references/commands.md` |
| Is this change finished? What must every task satisfy? | `references/definition-of-done.md` |

These summaries are navigation aids for the `comunicacaoAI` monorepo (`frontend/` + `backend/`
workspaces). After changing root scripts, the workspace list, fixed architecture, or the definition
of done, edit the reference here and run the drift check:

```bash
node .claude/skills/project-runbook/scripts/check-runbook.mjs
```
