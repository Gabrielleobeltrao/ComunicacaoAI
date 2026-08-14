// Run: node --test .claude/skills/execute-plan-task/scripts/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { extractTask, formatPacket } from "./extract-plan-task.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const planPath = resolve(here, "../../../../IMPLEMENTATION_PLAN.md");
const plan = readFileSync(planPath, "utf8");

const FIXTURE = [
  "## 7. Navigation architecture",
  "",
  "- The sidebar stays on the left.",
  "",
  "## 9. Execution phases and tasks",
  "",
  "### Phase 1 — Workspace foundation",
  "",
  "- [ ] **P1-T1 — First task**",
  "  - Do the thing described in Section 7.",
  "  - Verify: `npm test`.",
  "",
  "- [x] **P1-T2 — Second task**",
  "  - Another thing.",
  "",
  "**Checkpoint 1:** the foundation works.",
  "",
  "### Phase 2 — Later",
  "",
  "- [ ] **P2-T1 — Third task**",
  "  - Unrelated.",
  "",
].join("\n");

test("extracts one task with its phase, checkpoint and referenced section", () => {
  const packet = extractTask(FIXTURE, "P1-T1");
  assert.equal(packet.phase, "Phase 1 — Workspace foundation");
  assert.match(packet.task, /P1-T1 — First task/);
  assert.match(packet.checkpoint, /Checkpoint 1:/);
  assert.deepEqual(
    packet.sections.map((s) => s.number),
    [7],
  );
});

test("stops at the next task and never leaks a sibling", () => {
  const packet = extractTask(FIXTURE, "P1-T1");
  assert.doesNotMatch(packet.task, /Second task/);
  assert.doesNotMatch(packet.task, /Third task/);
});

test("rejects a missing task ID with exit code 2", () => {
  assert.throws(() => extractTask(FIXTURE, "P9-T9"), (error) => error.code === 2);
});

test("rejects a duplicate task ID with exit code 3", () => {
  const duplicated = `${FIXTURE}\n- [ ] **P1-T1 — First task**\n  - Duplicate.\n`;
  assert.throws(() => extractTask(duplicated, "P1-T1"), (error) => error.code === 3);
});

/**
 * The real plan, in whichever convention it uses.
 *
 * Two have been in the repository: `**P3-T2 — Title**` and `**3.2 Title**`. The skill reads the
 * plan the repository actually has, so these tests find its first task rather than naming one.
 */
const REAL_TASK = /^-\s*\[[ x~!]\]\s*\*\*(P\d+-T\d+|\d+\.\d+)\s*(?:—\s*)?/gm;

test("the real plan resolves a task packet far smaller than the whole plan", () => {
  const first = [...plan.matchAll(REAL_TASK)][0]?.[1];
  assert.ok(first, "the plan parsed into no tasks at all");

  const packet = formatPacket(extractTask(plan, first));
  assert.match(packet, new RegExp(first.replace(".", "\\.")));
  assert.ok(packet.length < plan.length / 4, `packet ${packet.length} vs plan ${plan.length}`);
});

test("every task ID in the real plan is unique and extractable", () => {
  const ids = [...plan.matchAll(REAL_TASK)].map((m) => m[1]);
  // A lower bound, not a count. It exists so a plan that stopped parsing fails loudly rather than
  // reporting zero tasks and passing; the exact number changes whenever the plan is replaced.
  assert.ok(ids.length > 10, `expected the plan to parse into tasks, found ${ids.length}`);
  assert.equal(new Set(ids).size, ids.length, "duplicate task IDs in the plan");
  for (const id of ids) assert.doesNotThrow(() => extractTask(plan, id), `failed to extract ${id}`);
});
