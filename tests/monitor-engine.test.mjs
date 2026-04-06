import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MonitorEngine } from "../dist/src/monitor-engine.js";

test("isWaveComplete only returns true when every task is complete", () => {
  const taskManager = {
    getTasksByWave() {
      return [
        { status: "complete" },
        { status: "failed" },
      ];
    },
  };

  const engine = new MonitorEngine(
    { isAlive: () => false, getOutput: () => "" },
    taskManager,
    { logEntry: () => {} },
  );

  assert.equal(engine.isWaveComplete(1), false);
});

test("isWaveComplete returns true for an all-complete wave", () => {
  const taskManager = {
    getTasksByWave() {
      return [
        { status: "complete" },
        { status: "complete" },
      ];
    },
  };

  const engine = new MonitorEngine(
    { isAlive: () => false, getOutput: () => "" },
    taskManager,
    { logEntry: () => {} },
  );

  assert.equal(engine.isWaveComplete(1), true);
});

test("monitor preserves terminal task status after the runtime exits", () => {
  const logEntries = [];
  const engine = new MonitorEngine(
    {
      isAlive: () => false,
      getOutput: () => "",
    },
    {
      readTask() {
        return { status: "complete" };
      },
    },
    {
      logEntry: (...args) => {
        logEntries.push(args);
      },
    },
  );

  const result = engine.monitor({
    taskId: "task-001",
    agentName: "Product Manager",
    correlationId: "corr-1",
    runtimeHandle: { id: "proc-001" },
  });

  assert.equal(result.runtimeAlive, false);
  assert.equal(result.taskStatus, "complete");
  assert.deepEqual(logEntries.at(-1), [
    "Monitor",
    "Agent Product Manager (task-001) runtime dead",
    { level: "warn", taskId: "task-001", correlationId: "corr-1" },
  ]);
});

test("monitor treats pi session file updates as activity even when stdout is unchanged", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-maestro-monitor-"));
  const workspaceDir = join(rootDir, "workspace");
  mkdirSync(workspaceDir, { recursive: true });

  const sessionFile = join(workspaceDir, "runtime-sessions", "task-001.jsonl");
  const taskFile = join(workspaceDir, "tasks", "task-001.md");
  mkdirSync(join(workspaceDir, "runtime-sessions"), { recursive: true });
  mkdirSync(join(workspaceDir, "tasks"), { recursive: true });
  writeFileSync(sessionFile, '{"type":"session"}\n', "utf-8");
  writeFileSync(taskFile, "# task-001\n\n**Status:** in_progress\n", "utf-8");

  const engine = new MonitorEngine(
    {
      isAlive: () => true,
      getOutput: () => "",
      getResult: () => ({
        artifacts: [
          { path: sessionFile, type: "pi-session" },
          { path: taskFile, type: "task-file" },
        ],
      }),
    },
    {
      readTask() {
        return { status: "in_progress" };
      },
    },
    { logEntry: () => {} },
  );

  const worker = {
    taskId: "task-001",
    agentName: "Planning Lead",
    correlationId: "corr-1",
    runtimeHandle: { id: "proc-001" },
    lastOutputAt: new Date("2026-04-06T16:40:00.000Z"),
  };

  const initial = engine.monitor(worker);
  assert.equal(initial.hasNewOutput, false);

  await new Promise(resolve => setTimeout(resolve, 20));
  writeFileSync(sessionFile, '{"type":"session"}\n{"type":"message"}\n', "utf-8");

  const followup = engine.monitor(worker);
  assert.equal(followup.hasNewOutput, true);
  assert.equal(followup.isStalled, false);
});
