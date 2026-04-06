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
