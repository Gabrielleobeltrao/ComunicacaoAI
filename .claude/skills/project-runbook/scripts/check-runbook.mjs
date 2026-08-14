#!/usr/bin/env node
// Fails when the runbook references drift from the real repository.
// Read-only. Run it after changing root scripts or the workspace list, then edit the references.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (relative) => readFileSync(resolve(root, relative), "utf8");

const pkg = JSON.parse(read("package.json"));
const commands = read(".claude/skills/project-runbook/references/commands.md");
const architecture = read(".claude/skills/project-runbook/references/architecture-map.md");

const problems = [];

for (const script of Object.keys(pkg.scripts ?? {})) {
  if (!commands.includes(`npm run ${script}`)) {
    problems.push(`commands.md does not document root script "${script}"`);
  }
}
for (const workspace of pkg.workspaces ?? []) {
  if (!architecture.includes(`\`${workspace}/\``)) {
    problems.push(`architecture-map.md does not document workspace "${workspace}"`);
  }
}

if (problems.length > 0) {
  process.stderr.write(`${problems.map((p) => `- ${p}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write("runbook references match package.json\n");
