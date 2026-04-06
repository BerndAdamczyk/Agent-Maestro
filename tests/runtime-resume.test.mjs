import test from "node:test";
import assert from "node:assert/strict";

import { PlainProcessAgentRuntime } from "../dist/src/runtime/plain-process-runtime.js";

test("plain-process runtime queues resume requests while the current turn is still alive", () => {
  const runtime = new PlainProcessAgentRuntime(1);
  const handle = makeHandle();
  const state = makeProcessState();

  runtime.processes.set(handle.id, state);

  runtime.resume(handle, {
    phase: "phase_2_execute",
    message: "Fix the handoff report and set the task back to complete.",
  });

  assert.deepEqual(state.pendingResume, {
    phase: "phase_2_execute",
    message: "Fix the handoff report and set the task back to complete.",
  });
});

test("plain-process runtime starts a queued resume turn after the previous turn exits", () => {
  const runtime = new PlainProcessAgentRuntime(1);
  const handle = makeHandle();
  const state = makeProcessState({
    child: null,
    pendingResume: {
      phase: "phase_2_execute",
      message: "Fix the handoff report and set the task back to complete.",
    },
  });

  const turns = [];
  runtime.startTurn = (_handle, _state, phase, message) => {
    turns.push({ phase, message });
  };

  const started = runtime.runPendingResume(handle, state);

  assert.equal(started, true);
  assert.equal(state.pendingResume, null);
  assert.deepEqual(turns, [
    {
      phase: "phase_2_execute",
      message: "Fix the handoff report and set the task back to complete.",
    },
  ]);
});

function makeHandle() {
  return {
    id: "proc-001",
    runtimeType: "process",
    agentName: "Planning Lead",
    taskId: "task-001",
    launchedAt: new Date().toISOString(),
  };
}

function makeProcessState(overrides = {}) {
  return {
    child: {
      exitCode: null,
      killed: false,
    },
    workspaceRoot: "/tmp/agent-maestro",
    output: [],
    result: {
      exitStatus: "running",
      handoffReportPath: null,
      artifacts: [],
      metrics: {
        startedAt: new Date().toISOString(),
      },
    },
    promptFilePath: "/tmp/prompt.md",
    sessionFilePath: "/tmp/session.jsonl",
    policyManifestPath: "/tmp/policy.json",
    model: "openai-codex/gpt-5.4",
    allowedTools: ["read", "write"],
    env: {},
    turnNumber: 1,
    pendingResume: null,
    ...overrides,
  };
}
