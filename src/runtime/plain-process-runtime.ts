/**
 * Host-process Pi runtime.
 * Reference: arc42 Sections 7, 8.12
 */

import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { join } from "node:path";
import type {
  AgentRuntimeLaunchParams,
  AgentRuntimeResumeParams,
  RuntimeHandle,
  RuntimeResult,
} from "../types.js";
import type { AgentRuntime } from "./agent-runtime.js";
import { appendRuntimeObservation } from "./runtime-log.js";
import { finalizeRuntimeResult, splitLines, writeTurnMessage } from "./pi-runtime-common.js";

interface ProcessState {
  child: ChildProcessByStdio<null, Readable, Readable> | null;
  workspaceRoot: string;
  output: string[];
  result: RuntimeResult;
  promptFilePath: string;
  sessionFilePath: string;
  policyManifestPath: string;
  model: string;
  allowedTools: string[];
  env: Record<string, string>;
  turnNumber: number;
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
    // No external dependency required beyond node + pi in PATH.
  }

  hasCapacity(): boolean {
    return [...this.processes.values()].filter(state => state.child !== null).length < this.maxConcurrent;
  }

  launch(params: AgentRuntimeLaunchParams): RuntimeHandle {
    this.ensureReady();

    const id = `proc-${String(this.nextId++).padStart(3, "0")}`;
    const startedAt = new Date().toISOString();

    const handle: RuntimeHandle = {
      id,
      runtimeType: "process",
      agentName: params.agentName,
      taskId: params.taskId,
      launchedAt: startedAt,
    };

    const state: ProcessState = {
      child: null,
      workspaceRoot: params.workspaceRoot,
      output: [],
      promptFilePath: params.promptFilePath,
      sessionFilePath: params.sessionFilePath,
      policyManifestPath: params.policyManifestPath,
      model: params.model,
      allowedTools: params.allowedTools,
      env: {
        ...params.env,
        MAESTRO_POLICY_PATH: params.policyManifestPath,
      },
      turnNumber: 0,
      result: {
        exitStatus: "running",
        handoffReportPath: params.taskFilePath,
        artifacts: [
          {
            path: params.taskFilePath,
            type: "task-file",
            description: "Task coordination file tracked by the process runtime.",
          },
          {
            path: params.sessionFilePath,
            type: "pi-session",
            description: "Persistent Pi session file for task turns.",
          },
          {
            path: params.policyManifestPath,
            type: "runtime-policy",
            description: "Runtime authority manifest consumed by the Pi policy extension.",
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

    this.processes.set(id, state);
    this.results.set(id, state.result);
    this.startTurn(handle, state, params.phase, launchMessage(params));
    return handle;
  }

  resume(handle: RuntimeHandle, params: AgentRuntimeResumeParams): void {
    const state = this.processes.get(handle.id);
    if (!state || this.isAlive(handle)) return;
    this.startTurn(handle, state, params.phase, params.message);
  }

  isAlive(handle: RuntimeHandle): boolean {
    const state = this.processes.get(handle.id);
    if (!state?.child) return false;
    return state.child.exitCode === null && !state.child.killed;
  }

  getOutput(handle: RuntimeHandle, lines: number = 200): string {
    const state = this.processes.get(handle.id);
    if (!state) return "";
    return state.output.slice(-lines).join("\n");
  }

  interrupt(handle: RuntimeHandle, reason: string): void {
    const state = this.processes.get(handle.id);
    if (!state) return;

    appendRuntimeObservation(state.workspaceRoot, handle.agentName, `[process runtime] interrupt: ${reason}`);
    if (state.child && this.isAlive(handle)) {
      state.child.kill("SIGINT");
    }
    state.result = finalizeRuntimeResult(state.result, "interrupted");
    this.results.set(handle.id, state.result);
  }

  destroy(handle: RuntimeHandle): void {
    const state = this.processes.get(handle.id);
    if (!state) return;

    if (state.child && this.isAlive(handle)) {
      state.child.kill("SIGTERM");
    }
    if (state.result.exitStatus === "running") {
      state.result = finalizeRuntimeResult(state.result, "interrupted");
      this.results.set(handle.id, state.result);
    }
    state.child = null;
    this.processes.delete(handle.id);
  }

  getResult(handle: RuntimeHandle): RuntimeResult | null {
    return this.processes.get(handle.id)?.result ?? this.results.get(handle.id) ?? null;
  }

  private startTurn(
    handle: RuntimeHandle,
    state: ProcessState,
    phase: string,
    message: string,
  ): void {
    state.turnNumber += 1;
    state.result = {
      ...state.result,
      exitStatus: "running",
      metrics: {
        ...state.result.metrics,
        retryCount: state.turnNumber - 1,
      },
    };
    this.results.set(handle.id, state.result);

    const messageFile = writeTurnMessage(
      join(state.workspaceRoot, "workspace", "runtime-turns"),
      handle.taskId,
      state.turnNumber,
      phase,
      message,
    );

    const child = spawn(
      process.execPath,
      [
        join(state.workspaceRoot, "dist", "src", "runtime", "pi-runner.js"),
        "--cwd",
        state.workspaceRoot,
        "--session-file",
        state.sessionFilePath,
        "--prompt-file",
        state.promptFilePath,
        "--message-file",
        messageFile,
        "--model",
        state.model,
        "--tools",
        state.allowedTools.join(","),
        "--extension",
        join(state.workspaceRoot, ".pi", "extensions", "maestro-policy.ts"),
      ],
      {
        cwd: state.workspaceRoot,
        env: {
          ...process.env,
          ...state.env,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    state.child = child;

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      state.output.push(...splitLines(text));
      appendRuntimeObservation(state.workspaceRoot, handle.agentName, text);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      state.output.push(...splitLines(text));
      appendRuntimeObservation(state.workspaceRoot, handle.agentName, `[stderr] ${text}`);
    });

    child.on("exit", code => {
      state.child = null;
      state.result = finalizeRuntimeResult(state.result, code === 0 ? "completed" : "failed");
      this.results.set(handle.id, state.result);
    });

    appendRuntimeObservation(
      state.workspaceRoot,
      handle.agentName,
      `[process runtime] turn=${state.turnNumber} phase=${phase} model=${state.model} tools=${state.allowedTools.join(",") || "none"}`,
    );
  }
}

function launchMessage(params: AgentRuntimeLaunchParams): string {
  return [
    `Start task ${params.taskId} as ${params.agentName}.`,
    `Current phase: ${params.phase}.`,
    "Read the task file first, then execute only the work required for this turn.",
  ].join("\n");
}
