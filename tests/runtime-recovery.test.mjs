import test from "node:test";
import assert from "node:assert/strict";

import { teardownPersistedRuntime } from "../dist/src/runtime/recovery.js";

test("teardownPersistedRuntime attempts tmux cleanup before resume failure", () => {
  const result = teardownPersistedRuntime({
    instanceId: "worker-001",
    agentName: "Engineering Lead",
    runtimeId: "%19",
    runtimeType: "tmux",
    taskId: "task-123",
    correlationId: "corr-task-123",
    role: "lead",
    hierarchyLevel: 1,
    startedAt: new Date().toISOString(),
    lastOutputAt: new Date().toISOString(),
    parentTaskId: null,
  });

  assert.equal(result.attempted, true);
  assert.deepEqual(result.commands, ["tmux kill-pane -t %19"]);
});

test("teardownPersistedRuntime attempts process cleanup before resume failure", () => {
  const result = teardownPersistedRuntime({
    instanceId: "worker-002",
    agentName: "Backend Dev",
    runtimeId: "proc-004",
    runtimeType: "process",
    taskId: "task-456",
    correlationId: "corr-task-456",
    role: "worker",
    hierarchyLevel: 2,
    startedAt: new Date().toISOString(),
    lastOutputAt: new Date().toISOString(),
    parentTaskId: "task-111",
  });

  assert.equal(result.attempted, true);
  assert.equal(result.commands.length, 1);
  assert.match(result.commands[0], /^bash -lc /);
  assert.match(result.commands[0], /task-456/);
});

test("teardownPersistedRuntime attempts container cleanup before resume failure", () => {
  const result = teardownPersistedRuntime({
    instanceId: "worker-003",
    agentName: "QA Engineer",
    runtimeId: "container-789",
    runtimeType: "container",
    taskId: "task-789",
    correlationId: "corr-task-789",
    role: "worker",
    hierarchyLevel: 2,
    startedAt: new Date().toISOString(),
    lastOutputAt: new Date().toISOString(),
    parentTaskId: null,
  });

  assert.equal(result.attempted, true);
  assert.ok(result.commands.some(command => command.includes("docker ps -aq --filter name=agent-maestro-task-789-")));
});

test("teardownPersistedRuntime leaves unknown runtimes untouched", () => {
  const result = teardownPersistedRuntime({
    instanceId: "worker-004",
    agentName: "Unknown",
    runtimeId: "runtime-000",
    runtimeType: "dry-run",
    taskId: "task-000",
    correlationId: "corr-task-000",
    role: "maestro",
    hierarchyLevel: 0,
    startedAt: new Date().toISOString(),
    lastOutputAt: new Date().toISOString(),
    parentTaskId: null,
  });

  assert.equal(result.attempted, false);
  assert.deepEqual(result.commands, []);
});
