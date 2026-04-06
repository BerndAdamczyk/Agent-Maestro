/**
 * Decision helpers for inactive worker runtimes.
 */

import type {
  InactiveRuntimeDisposition,
  RuntimeExitStatus,
  TaskStatus,
} from "../types.js";

const TERMINAL_TASK_STATUSES = new Set<TaskStatus>([
  "complete",
  "failed",
  "plan_ready",
  "plan_approved",
  "plan_revision_needed",
]);

export function classifyInactiveRuntime(params: {
  taskStatus: TaskStatus | null;
  exitStatus: RuntimeExitStatus | null;
  retryCount: number;
  maxRetryAttempts: number;
}): InactiveRuntimeDisposition {
  if (params.taskStatus && TERMINAL_TASK_STATUSES.has(params.taskStatus)) {
    return "respect_terminal_status";
  }

  if (params.exitStatus === "completed") {
    return params.retryCount < params.maxRetryAttempts
      ? "resume_non_terminal"
      : "fail_clean_exit_exhausted";
  }

  return "crash";
}

export function buildNonTerminalResumeMessage(taskId: string, nextTurnNumber: number, maxRetryAttempts: number): string {
  return [
    `Your previous turn ended before ${taskId} reached a terminal task status.`,
    `Continue immediately with turn ${nextTurnNumber} of at most ${maxRetryAttempts + 1}.`,
    "Re-read the task file before making further edits.",
    "Do not stop after an intermediate progress update, scoping note, or partial inspection.",
    "Stay in this turn until one of the following is true:",
    "- the task file is updated to a terminal status with the required handoff/plan sections",
    "- you are blocked by a concrete missing dependency or tool/policy limitation, which you must record in the task file",
  ].join("\n");
}
