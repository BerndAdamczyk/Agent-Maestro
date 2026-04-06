import test from "node:test";
import assert from "node:assert/strict";

import {
  buildNonTerminalResumeMessage,
  classifyInactiveRuntime,
} from "../dist/src/runtime/inactive-runtime.js";

test("classifyInactiveRuntime resumes clean non-terminal exits within retry budget", () => {
  const disposition = classifyInactiveRuntime({
    taskStatus: "in_progress",
    exitStatus: "completed",
    retryCount: 1,
    maxRetryAttempts: 3,
  });

  assert.equal(disposition, "resume_non_terminal");
});

test("classifyInactiveRuntime fails clean non-terminal exits after retry budget is exhausted", () => {
  const disposition = classifyInactiveRuntime({
    taskStatus: "in_progress",
    exitStatus: "completed",
    retryCount: 3,
    maxRetryAttempts: 3,
  });

  assert.equal(disposition, "fail_clean_exit_exhausted");
});

test("classifyInactiveRuntime respects terminal task statuses", () => {
  const disposition = classifyInactiveRuntime({
    taskStatus: "complete",
    exitStatus: "completed",
    retryCount: 0,
    maxRetryAttempts: 3,
  });

  assert.equal(disposition, "respect_terminal_status");
});

test("buildNonTerminalResumeMessage forbids progress-only turn endings", () => {
  const message = buildNonTerminalResumeMessage("task-004", 2, 3);

  assert.match(message, /turn 2/);
  assert.match(message, /Do not stop after an intermediate progress update/);
});
