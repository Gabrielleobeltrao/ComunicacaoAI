#!/usr/bin/env node
// Extracts exactly one task packet from IMPLEMENTATION_PLAN.md.
// Read-only: this script never writes to the plan. The skill owns checkbox changes.
//
// Usage: node extract-plan-task.mjs <TASK-ID> [--plan <path>]
// Exit codes: 0 ok, 1 usage error, 2 task not found, 3 duplicate task ID.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A task line, in either convention this repository has used.
 *
 * `**P3-T2 — Title**` was the first. `**3.2 Title**` is what the current plan uses, and the skill
 * has to read the plan the repository actually has rather than the one it was written against —
 * otherwise loading a task silently finds nothing and the whole point of the skill is lost.
 */
const TASK_HEADING = /^-\s*\[([ x~!])\]\s*\*\*(P\d+-T\d+|\d+\.\d+)\s*(?:—\s*)?(.+?)\*\*(.*)$/;
const PHASE_HEADING = /^###\s+Phase\s+(\d+)\s*—\s*(.+)$/;
const CHECKPOINT = /^\*\*Checkpoint\s+(\d+):/;
const SECTION_HEADING = /^##\s+(\d+)\.\s+(.+)$/;
const SECTION_REFERENCE = /\bSection\s+(\d+)\b/g;

export function extractTask(planText, taskId) {
  const lines = planText.split("\n");

  const matches = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = TASK_HEADING.exec(lines[i]);
    if (m && m[2] === taskId) matches.push(i);
  }
  if (matches.length === 0) {
    const error = new Error(`Task ${taskId} not found in the plan.`);
    error.code = 2;
    throw error;
  }
  if (matches.length > 1) {
    const error = new Error(
      `Task ${taskId} is defined ${matches.length} times (lines ${matches.map((i) => i + 1).join(", ")}). Fix the plan first.`,
    );
    error.code = 3;
    throw error;
  }

  const start = matches[0];
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (TASK_HEADING.test(line) || PHASE_HEADING.test(line) || CHECKPOINT.test(line) || /^##\s/.test(line)) break;
    end += 1;
  }
  const taskLines = lines.slice(start, end);
  while (taskLines.length > 0 && taskLines[taskLines.length - 1].trim() === "") taskLines.pop();
  const task = taskLines.join("\n");

  let phase = null;
  for (let i = start; i >= 0; i -= 1) {
    if (PHASE_HEADING.test(lines[i])) {
      phase = lines[i].replace(/^###\s+/, "");
      break;
    }
  }

  let checkpoint = null;
  for (let i = start; i < lines.length; i += 1) {
    if (PHASE_HEADING.test(lines[i]) && i > start) break;
    if (CHECKPOINT.test(lines[i])) {
      checkpoint = lines[i];
      break;
    }
  }

  const referenced = new Set();
  for (const m of task.matchAll(SECTION_REFERENCE)) referenced.add(Number(m[1]));

  const sections = [];
  for (const number of [...referenced].sort((a, b) => a - b)) {
    const from = lines.findIndex((line) => {
      const m = SECTION_HEADING.exec(line);
      return m && Number(m[1]) === number;
    });
    if (from === -1) continue;
    let to = from + 1;
    while (to < lines.length && !/^##\s/.test(lines[to])) to += 1;
    sections.push({ number, text: lines.slice(from, to).join("\n").trimEnd() });
  }

  return { taskId, phase, task, checkpoint, sections };
}

export function formatPacket(packet) {
  const parts = [`# Task packet: ${packet.taskId}`];
  if (packet.phase) parts.push(`## ${packet.phase}`);
  parts.push(packet.task);
  if (packet.checkpoint) parts.push(packet.checkpoint);
  for (const section of packet.sections) {
    parts.push(`---\n\n<!-- Referenced architecture -->\n${section.text}`);
  }
  return `${parts.join("\n\n")}\n`;
}

function main(argv) {
  const args = argv.slice(2);
  const planFlag = args.indexOf("--plan");
  let planPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../IMPLEMENTATION_PLAN.md");
  if (planFlag !== -1) {
    if (!args[planFlag + 1]) {
      process.stderr.write("Usage: extract-plan-task.mjs <TASK-ID> [--plan <path>]\n");
      process.exit(1);
    }
    planPath = resolve(args[planFlag + 1]);
    args.splice(planFlag, 2);
  }
  if (args.length !== 1 || !/^(P\d+-T\d+|\d+\.\d+)$/.test(args[0])) {
    process.stderr.write("Usage: extract-plan-task.mjs <TASK-ID> [--plan <path>]\n");
    process.exit(1);
  }
  try {
    process.stdout.write(formatPacket(extractTask(readFileSync(planPath, "utf8"), args[0])));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(error.code ?? 1);
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main(process.argv);
