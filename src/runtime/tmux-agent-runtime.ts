/**
 * tmux-backed AgentRuntime implementation.
 */

import type {
  AgentRuntimeLaunchParams,
  AgentRuntimeResumeParams,
  RuntimeHandle,
  RuntimeResult,
} from "../types.js";
import type { AgentRuntime } from "./agent-runtime.js";
import { RuntimeManager } from "../runtime-manager.js";
import { sanitizeForShell } from "../utils.js";

export class TmuxAgentRuntime implements AgentRuntime {
  private manager: RuntimeManager;
  private results = new Map<string, RuntimeResult>();

  constructor(manager: RuntimeManager) {
    this.manager = manager;
  }

  ensureReady(): void {
    this.manager.ensureSession();
  }

  hasCapacity(): boolean {
    return this.manager.hasCapacity();
  }

  launch(params: AgentRuntimeLaunchParams): RuntimeHandle {
    this.ensureReady();

    const paneId = this.manager.createPane(params.agentName);
    const startedAt = new Date().toISOString();

    const handle: RuntimeHandle = {
      id: paneId,
      runtimeType: "tmux",
      agentName: params.agentName,
      taskId: params.taskId,
      launchedAt: startedAt,
    };

    this.results.set(paneId, {
      exitStatus: "running",
      handoffReportPath: params.taskFilePath,
      artifacts: [
        {
          path: params.taskFilePath,
          type: "task-file",
          description: "Task coordination file tracked by the runtime.",
        },
      ],
      metrics: {
        startedAt,
        tokenUsage: null,
        retryCount: 0,
        failoverCount: 0,
      },
    });

    this.manager.sendKeys(paneId, this.buildLaunchCommand(params));
    return handle;
  }

  resume(handle: RuntimeHandle, params: AgentRuntimeResumeParams): void {
    if (!this.isAlive(handle)) return;

    const message = sanitizeForShell(params.message).trim() || "Resume requested";
    this.manager.sendKeys(
      handle.id,
      `printf '%s\\n' ${shellQuote(`[runtime resume] phase=${params.phase}`)} && printf '%s\\n' ${shellQuote(message)}`,
    );
  }

  isAlive(handle: RuntimeHandle): boolean {
    return this.manager.isAlive(handle.id);
  }

  getOutput(handle: RuntimeHandle, lines: number = 200): string {
    return this.manager.capturePane(handle.id, lines);
  }

  interrupt(handle: RuntimeHandle, reason: string): void {
    const result = this.results.get(handle.id);
    if (result) {
      this.results.set(handle.id, finalizeResult(result, "interrupted"));
    }

    if (this.isAlive(handle)) {
      this.manager.sendKeys(
        handle.id,
        `printf '%s\\n' ${shellQuote(`[runtime interrupt] ${sanitizeForShell(reason)}`)}`,
      );
    }
  }

  destroy(handle: RuntimeHandle): void {
    const result = this.results.get(handle.id);
    if (result && result.exitStatus === "running") {
      this.results.set(handle.id, finalizeResult(result, "interrupted"));
    }

    this.manager.destroyPane(handle.id);
  }

  getResult(handle: RuntimeHandle): RuntimeResult | null {
    return this.results.get(handle.id) ?? null;
  }

  private buildLaunchCommand(params: AgentRuntimeLaunchParams): string {
    const toolSummary = params.allowedTools.length > 0
      ? params.allowedTools.join(", ")
      : "none";

    return [
      `printf '%s\\n' ${shellQuote(`[tmux runtime] agent=${params.agentName} task=${params.taskId}`)}`,
      `printf '%s\\n' ${shellQuote(`[tmux runtime] prompt_chars=${params.systemPrompt.length} timeout_ms=${params.timeoutMs}`)}`,
      `printf '%s\\n' ${shellQuote(`[tmux runtime] allowed_tools=${toolSummary}`)}`,
      `printf '%s\\n' ${shellQuote("[tmux runtime] backend placeholder: integrate Pi runtime here")}`,
    ].join(" && ");
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
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
