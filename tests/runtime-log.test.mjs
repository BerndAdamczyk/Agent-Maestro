import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appendRuntimeObservation } from "../dist/src/runtime/runtime-log.js";

test("appendRuntimeObservation prefixes task and correlation identifiers in runtime log lines", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "agent-maestro-runtime-log-"));

  appendRuntimeObservation(workspaceRoot, "QA Engineer", "started\u0007 turn", {
    taskId: "task-004",
    correlationId: "corr-004",
  });

  const content = readFileSync(join(workspaceRoot, "logs", "qa-engineer.log"), "utf-8");
  assert.match(content, /^\[[^\]]+\] task=task-004 corr=corr-004 started turn\n$/);
  assert.doesNotMatch(content, /\u0007/);
});
