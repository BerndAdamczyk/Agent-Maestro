import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Logger } from "../dist/src/logger.js";
import { StatusManager } from "../dist/src/status-manager.js";
import { TaskManager } from "../dist/src/task-manager.js";
import { formatTimestamp } from "../dist/src/utils.js";

test("formatTimestamp returns local ISO 8601 with an explicit offset", () => {
  const formatted = formatTimestamp(new Date("2026-04-06T14:11:23.456Z"));

  assert.match(formatted, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  assert.equal(formatted.includes("Z"), false);
});

test("logger writes timestamps with explicit offsets", () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), "agent-maestro-log-"));
  const logger = new Logger(workspaceDir);

  logger.initialize();
  logger.logEntry("Maestro", "Session started");

  const entry = JSON.parse(readFileSync(join(workspaceDir, "log.jsonl"), "utf-8").trim());
  assert.match(entry.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
});

test("status manager writes last-updated timestamps with explicit offsets", () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), "agent-maestro-status-"));
  mkdirSync(join(workspaceDir, "tasks"), { recursive: true });
  const taskManager = new TaskManager(workspaceDir);
  const statusManager = new StatusManager(workspaceDir, taskManager);

  statusManager.refresh();

  const content = readFileSync(join(workspaceDir, "status.md"), "utf-8");
  assert.match(content, /_Last updated: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}_/);
});
