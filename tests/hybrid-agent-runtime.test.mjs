import test from "node:test";
import assert from "node:assert/strict";

import { HybridAgentRuntime } from "../dist/src/runtime/hybrid-agent-runtime.js";

test("HybridAgentRuntime tears down persisted tmux handles through the host backend fallback", () => {
  const hostDestroyed = [];
  const workerDestroyed = [];

  const runtime = new HybridAgentRuntime(
    makeRuntime(hostDestroyed),
    makeRuntime(workerDestroyed),
    4,
  );

  runtime.destroy({
    id: "%19",
    runtimeType: "tmux",
    agentName: "Engineering Lead",
    taskId: "task-003",
    launchedAt: "2026-04-06T19:03:28+02:00",
  });

  assert.equal(hostDestroyed.length, 1);
  assert.equal(hostDestroyed[0].id, "%19");
  assert.equal(workerDestroyed.length, 0);
});

function makeRuntime(destroyed) {
  return {
    ensureReady: () => {},
    hasCapacity: () => true,
    launch: () => {
      throw new Error("launch should not be called");
    },
    resume: () => {},
    isAlive: () => false,
    getOutput: () => "",
    interrupt: () => {},
    destroy: handle => {
      destroyed.push(handle);
    },
    getResult: () => null,
  };
}
