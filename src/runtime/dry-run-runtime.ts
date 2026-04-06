/**
 * Dry-run AgentRuntime implementation for control-plane testing.
 *
 * This backend does not execute an agent. It records deterministic output so
 * orchestration can be exercised without tmux or a real coding-agent runtime.
 */

import type {
  AgentRuntimeLaunchParams,
  AgentRuntimeResumeParams,
  RuntimeHandle,
  RuntimeResult,
} from "../types.js";
import type { AgentRuntime } from "./agent-runtime.js";

interface DryRunState {
  handle: RuntimeHandle;
  output: string[];
  alive: boolean;
  result: RuntimeResult;
}

export class DryRunAgentRuntime implements AgentRuntime {
  private nextId = 1;
  private handles = new Map<string, DryRunState>();
  private maxConcurrent: number;

  constructor(maxConcurrent: number = Number.POSITIVE_INFINITY) {
    this.maxConcurrent = maxConcurrent;
  }

  ensureReady(): void {
    // No external runtime to initialize.
  }

  hasCapacity(): boolean {
    return this.handles.size < this.maxConcurrent;
  }

  launch(params: AgentRuntimeLaunchParams): RuntimeHandle {
    const id = `dry-run-${String(this.nextId++).padStart(3, "0")}`;
    const startedAt = new Date().toISOString();

    const handle: RuntimeHandle = {
      id,
      runtimeType: "dry-run",
      agentName: params.agentName,
      taskId: params.taskId,
      launchedAt: startedAt,
    };

    const state: DryRunState = {
      handle,
      output: [
        `[dry-run runtime] agent=${params.agentName} task=${params.taskId}`,
        `[dry-run runtime] prompt_chars=${params.systemPrompt.length} timeout_ms=${params.timeoutMs}`,
        `[dry-run runtime] allowed_tools=${params.allowedTools.join(", ") || "none"}`,
        `[dry-run runtime] no agent process launched; update task state externally or switch to tmux runtime`,
      ],
      alive: true,
      result: {
        exitStatus: "running",
        handoffReportPath: params.taskFilePath,
        artifacts: [
          {
            path: params.taskFilePath,
            type: "task-file",
            description: "Task coordination file tracked during dry-run.",
          },
        ],
        metrics: {
          startedAt,
          tokenUsage: null,
          retryCount: 0,
          failoverCount: 0,
        },
      },
    };

    this.handles.set(id, state);
    return handle;
  }

  resume(handle: RuntimeHandle, params: AgentRuntimeResumeParams): void {
    const state = this.handles.get(handle.id);
    if (!state) return;
    state.output.push(`[dry-run runtime] resume phase=${params.phase}: ${params.message}`);
  }

  isAlive(handle: RuntimeHandle): boolean {
    return this.handles.get(handle.id)?.alive ?? false;
  }

  getOutput(handle: RuntimeHandle, lines: number = 200): string {
    const state = this.handles.get(handle.id);
    if (!state) return "";
    return state.output.slice(-lines).join("\n");
  }

  interrupt(handle: RuntimeHandle, reason: string): void {
    const state = this.handles.get(handle.id);
    if (!state) return;

    state.output.push(`[dry-run runtime] interrupted: ${reason}`);
    state.alive = false;
    state.result = finalizeResult(state.result, "interrupted");
  }

  destroy(handle: RuntimeHandle): void {
    const state = this.handles.get(handle.id);
    if (!state) return;

    if (state.result.exitStatus === "running") {
      state.result = finalizeResult(state.result, "interrupted");
    }
    state.alive = false;
  }

  getResult(handle: RuntimeHandle): RuntimeResult | null {
    return this.handles.get(handle.id)?.result ?? null;
  }
}

function finalizeResult(result: RuntimeResult, exitStatus: RuntimeResult["exitStatus"]): RuntimeResult {
  const finishedAt = new Date().toISOString();
  const startedAt = result.metrics.startedAt;

  return {
    ...result,
    exitStatus,
    metrics: {
      ...result.metrics,
      finishedAt,
      durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
    },
  };
}
