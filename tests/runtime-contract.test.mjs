import test from "node:test";
import assert from "node:assert/strict";

import { appendRuntimeLifecycleEvent, createRuntimeEventEnvelope } from "../dist/src/runtime/contracts.js";
import { TmuxAgentRuntime } from "../dist/src/runtime/tmux-agent-runtime.js";

test("appendRuntimeLifecycleEvent records canonical lifecycle metadata", () => {
  const event = createRuntimeEventEnvelope({
    lifecycle: "launch_started",
    taskId: "task-001",
    correlationId: "corr-001",
    agentName: "Backend Dev",
    runtimeType: "process",
    runtimeId: "proc-001",
    details: { phase: "phase_2_execute" },
  });

  const result = appendRuntimeLifecycleEvent(
    {
      exitStatus: "running",
      handoffReportPath: null,
      artifacts: [],
      metrics: {
        startedAt: new Date("2026-04-08T00:00:00.000Z").toISOString(),
      },
    },
    event,
  );

  assert.equal(result.lifecycleState, "launch_started");
  assert.equal(result.lastLifecycleEvent?.taskId, "task-001");
  assert.equal(result.lifecycleEvents?.length, 1);
  assert.equal(result.lifecycleEvents?.[0]?.details?.phase, "phase_2_execute");
});

test("tmux runtime normalizes completed turn results from pane output markers", () => {
  let paneOutput = "";
  const manager = {
    ensureSession: () => {},
    hasCapacity: () => true,
    createPane: () => "%19",
    isAlive: () => true,
    capturePane: () => paneOutput,
    sendKeys: () => {},
    sendInterrupt: () => {},
    destroyPane: () => {},
  };

  const runtime = new TmuxAgentRuntime(manager);
  const handle = runtime.launch({
    agentName: "Backend Dev",
    taskId: "task-010",
    correlationId: "corr-010",
    role: "worker",
    phase: "phase_2_execute",
    model: "openai/gpt-5-mini",
    systemPrompt: "SYSTEM",
    promptFilePath: "/tmp/prompt.md",
    taskFilePath: "/tmp/task.md",
    sessionFilePath: "/tmp/session.jsonl",
    policyManifestPath: "/tmp/policy.json",
    workspaceRoot: "/tmp/agent-maestro",
    allowedTools: ["read", "write"],
    timeoutMs: 60_000,
    env: {},
  });

  const state = runtime.states.get(handle.id);
  paneOutput = `__MAESTRO_TURN_END__:${state.currentTurnToken}:0`;

  const alive = runtime.isAlive(handle);
  const result = runtime.getResult(handle);

  assert.equal(alive, false);
  assert.equal(result?.exitStatus, "completed");
  assert.equal(result?.lifecycleState, "completed");
  assert.equal(result?.lastLifecycleEvent?.details?.exitCode, 0);
});
