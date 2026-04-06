import test from "node:test";
import assert from "node:assert/strict";

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
