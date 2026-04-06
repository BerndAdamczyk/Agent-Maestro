/**
 * child_process.spawn-backed AgentRuntime fallback.
 * Reference: arc42 Sections 7, 8.12
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type {
  AgentRuntimeLaunchParams,
  AgentRuntimeResumeParams,
  RuntimeHandle,
  RuntimeResult,
} from "../types.js";
import type { AgentRuntime } from "./agent-runtime.js";
import { appendRuntimeObservation } from "./runtime-log.js";

interface ProcessState {
  child: ChildProcessWithoutNullStreams;
  workspaceRoot: string;
  output: string[];
  result: RuntimeResult;
}

export class PlainProcessAgentRuntime implements AgentRuntime {
  private nextId = 1;
  private maxConcurrent: number;
  private processes = new Map<string, ProcessState>();
  private results = new Map<string, RuntimeResult>();

  constructor(maxConcurrent: number) {
    this.maxConcurrent = maxConcurrent;
  }

  ensureReady(): void {
    // No external dependency required.
  }

  hasCapacity(): boolean {
    return this.processes.size < this.maxConcurrent;
  }

  launch(params: AgentRuntimeLaunchParams): RuntimeHandle {
    this.ensureReady();

    const id = `proc-${String(this.nextId++).padStart(3, "0")}`;
    const startedAt = new Date().toISOString();
    const shell = process.env["SHELL"] || "/bin/bash";

    const child = spawn(shell, ["-lc", "while IFS= read -r line; do printf '%s\\n' \"$line\"; done"], {
      cwd: params.workspaceRoot,
      env: {
        ...process.env,
        ...params.env,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const handle: RuntimeHandle = {
      id,
      runtimeType: "process",
      agentName: params.agentName,
      taskId: params.taskId,
      launchedAt: startedAt,
    };

    const state: ProcessState = {
      child,
      workspaceRoot: params.workspaceRoot,
      output: [],
      result: {
        exitStatus: "running",
        handoffReportPath: params.taskFilePath,
        artifacts: [
          {
            path: params.taskFilePath,
            type: "task-file",
            description: "Task coordination file tracked by the plain-process runtime.",
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
    this.results.set(id, state.result);

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      state.output.push(...splitLines(text));
      appendRuntimeObservation(params.workspaceRoot, params.agentName, text);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      state.output.push(...splitLines(text));
      appendRuntimeObservation(params.workspaceRoot, params.agentName, `[stderr] ${text}`);
    });

    child.on("exit", (code, signal) => {
      const exitStatus =
        signal === "SIGINT" || signal === "SIGTERM"
          ? "interrupted"
          : code === 0
            ? "completed"
            : "failed";

      state.result = finalizeResult(state.result, exitStatus);
      this.results.set(id, state.result);
    });

    this.processes.set(id, state);
    this.writeLine(handle, `[plain-process runtime] launched task=${params.taskId} timeout_ms=${params.timeoutMs}`);
    this.writeLine(handle, `[plain-process runtime] prompt_chars=${params.systemPrompt.length}`);
    this.writeLine(handle, `[plain-process runtime] allowed_tools=${params.allowedTools.join(", ") || "none"}`);
    this.writeLine(handle, "[plain-process runtime] backend placeholder: integrate Pi runtime here");
    return handle;
  }

  resume(handle: RuntimeHandle, params: AgentRuntimeResumeParams): void {
    this.writeLine(handle, `[plain-process runtime] resume phase=${params.phase}`);
    this.writeLine(handle, params.message);
  }

  isAlive(handle: RuntimeHandle): boolean {
    const state = this.processes.get(handle.id);
    if (!state) return false;
    return state.child.exitCode === null && !state.child.killed;
  }

  getOutput(handle: RuntimeHandle, lines: number = 200): string {
    const state = this.processes.get(handle.id);
    if (!state) return "";
    return state.output.slice(-lines).join("\n");
  }

  interrupt(handle: RuntimeHandle, reason: string): void {
    this.writeLine(handle, `[plain-process runtime] interrupt: ${reason}`);
    const state = this.processes.get(handle.id);
    if (!state) return;

    state.child.kill("SIGINT");
    state.result = finalizeResult(state.result, "interrupted");
    this.results.set(handle.id, state.result);
  }

  destroy(handle: RuntimeHandle): void {
    const state = this.processes.get(handle.id);
    if (!state) return;

    this.writeLine(handle, "[plain-process runtime] destroy");
    if (this.isAlive(handle)) {
      state.child.kill("SIGTERM");
    }
    state.result = finalizeResult(state.result, "interrupted");
    this.results.set(handle.id, state.result);
    this.processes.delete(handle.id);
  }

  getResult(handle: RuntimeHandle): RuntimeResult | null {
    return this.processes.get(handle.id)?.result ?? this.results.get(handle.id) ?? null;
  }

  private writeLine(handle: RuntimeHandle, line: string): void {
    const state = this.processes.get(handle.id);
    if (!state || !this.isAlive(handle)) return;

    state.child.stdin.write(line + "\n");
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

function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(Boolean);
}
