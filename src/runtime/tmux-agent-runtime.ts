/**
 * tmux-backed Pi runtime for Maestro and Team-Leads.
 */

import { join } from "node:path";
import type {
  AgentRuntimeLaunchParams,
  AgentRuntimeResumeParams,
  RuntimeHandle,
  RuntimeResult,
} from "../types.js";
import type { AgentRuntime } from "./agent-runtime.js";
import { RuntimeManager } from "../runtime-manager.js";
import { getForwardedProviderEnv, resolvePiAgentDir, resolvePiCommand } from "../pi-runtime-support.js";
import { appendRuntimeObservation } from "./runtime-log.js";
import { finalizeRuntimeResult, writeTurnMessage } from "./pi-runtime-common.js";
import { appendRuntimeLifecycleEvent, createRuntimeEventEnvelope } from "./contracts.js";

interface TmuxState {
  workspaceRoot: string;
  promptFilePath: string;
  sessionFilePath: string;
  policyManifestPath: string;
  model: string;
  allowedTools: string[];
  env: Record<string, string>;
  turnNumber: number;
  currentTurnToken: string | null;
  pendingResume: AgentRuntimeResumeParams | null;
  correlationId: string | null;
  result: RuntimeResult;
}

export class TmuxAgentRuntime implements AgentRuntime {
  private manager: RuntimeManager;
  private states = new Map<string, TmuxState>();
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
    const piAgentDir = resolvePiAgentDir();

    const state: TmuxState = {
      workspaceRoot: params.workspaceRoot,
      promptFilePath: params.promptFilePath,
      sessionFilePath: params.sessionFilePath,
      policyManifestPath: params.policyManifestPath,
      model: params.model,
      allowedTools: params.allowedTools,
      env: {
        ...getForwardedProviderEnv(),
        ...params.env,
        PI_BIN: resolvePiCommand(),
        ...(piAgentDir ? { PI_CODING_AGENT_DIR: piAgentDir } : {}),
        MAESTRO_POLICY_PATH: params.policyManifestPath,
      },
      turnNumber: 0,
      currentTurnToken: null,
      pendingResume: null,
      correlationId: params.correlationId ?? null,
      result: appendRuntimeLifecycleEvent({
        exitStatus: "running",
        handoffReportPath: params.taskFilePath,
        artifacts: [
          {
            path: params.taskFilePath,
            type: "task-file",
            description: "Task coordination file tracked by the tmux runtime.",
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
      }, createRuntimeEventEnvelope({
        lifecycle: "launch_requested",
        taskId: params.taskId,
        correlationId: params.correlationId ?? null,
        agentName: params.agentName,
        runtimeType: "tmux",
        runtimeId: paneId,
      })),
    };

    this.states.set(paneId, state);
    this.results.set(paneId, state.result);
    this.startTurn(handle, state, params.phase, launchMessage(params));
    return handle;
  }

  resume(handle: RuntimeHandle, params: AgentRuntimeResumeParams): void {
    const state = this.states.get(handle.id);
    if (!state) return;
    if (params.allowedTools) {
      state.allowedTools = [...params.allowedTools];
    }
    if (params.policyManifestPath) {
      state.policyManifestPath = params.policyManifestPath;
    }
    if (this.isAlive(handle)) {
      state.result = appendRuntimeLifecycleEvent(state.result, createRuntimeEventEnvelope({
        lifecycle: "resume_requested",
        taskId: handle.taskId,
        correlationId: state.correlationId,
        agentName: handle.agentName,
        runtimeType: handle.runtimeType,
        runtimeId: handle.id,
      }));
      this.results.set(handle.id, state.result);
      state.pendingResume = params;
      return;
    }
    state.pendingResume = null;
    this.startTurn(handle, state, params.phase, params.message);
  }

  isAlive(handle: RuntimeHandle): boolean {
    const state = this.states.get(handle.id);
    if (!state) return false;
    if (!this.manager.isAlive(handle.id)) return false;
    if (!state.currentTurnToken) return false;
    const output = this.manager.capturePane(handle.id, 200);
    const endMarker = `__MAESTRO_TURN_END__:${state.currentTurnToken}:`;
    if (!output.includes(endMarker)) {
      return true;
    }

    const exitCode = parseTurnExitCode(output, endMarker);
    if (state.result.exitStatus === "running") {
      state.result = appendRuntimeLifecycleEvent(
        finalizeRuntimeResult(state.result, exitCode === 0 ? "completed" : "failed"),
        createRuntimeEventEnvelope({
          lifecycle: exitCode === 0 ? "completed" : "failed",
          taskId: handle.taskId,
          correlationId: state.correlationId,
          agentName: handle.agentName,
          runtimeType: handle.runtimeType,
          runtimeId: handle.id,
          details: {
            exitCode,
            turnNumber: state.turnNumber,
          },
        }),
      );
      this.results.set(handle.id, state.result);
    }

    return this.runPendingResume(handle, state);
  }

  getOutput(handle: RuntimeHandle, lines: number = 200): string {
    return this.manager.capturePane(handle.id, lines);
  }

  interrupt(handle: RuntimeHandle, reason: string): void {
    const state = this.states.get(handle.id);
    if (!state) return;

    state.pendingResume = null;
    appendRuntimeObservation(state.workspaceRoot, handle.agentName, `[tmux runtime] interrupt: ${reason}`, {
      taskId: handle.taskId,
      correlationId: state.correlationId,
    });
    this.manager.sendInterrupt(handle.id);
    state.result = appendRuntimeLifecycleEvent(
      finalizeRuntimeResult(state.result, "interrupted"),
      createRuntimeEventEnvelope({
        lifecycle: "interrupted",
        taskId: handle.taskId,
        correlationId: state.correlationId,
        agentName: handle.agentName,
        runtimeType: handle.runtimeType,
        runtimeId: handle.id,
        details: { reason },
      }),
    );
    this.results.set(handle.id, state.result);
  }

  destroy(handle: RuntimeHandle): void {
    const state = this.states.get(handle.id);
    if (!state) {
      this.manager.destroyPane(handle.id);
      return;
    }

    state.pendingResume = null;
    if (state.result.exitStatus === "running") {
      state.result = appendRuntimeLifecycleEvent(
        finalizeRuntimeResult(state.result, "interrupted"),
        createRuntimeEventEnvelope({
          lifecycle: "destroyed",
          taskId: handle.taskId,
          correlationId: state.correlationId,
          agentName: handle.agentName,
          runtimeType: handle.runtimeType,
          runtimeId: handle.id,
        }),
      );
      this.results.set(handle.id, state.result);
    }

    appendRuntimeObservation(state.workspaceRoot, handle.agentName, "[tmux runtime] destroy", {
      taskId: handle.taskId,
      correlationId: state.correlationId,
    });
    this.manager.destroyPane(handle.id);
    this.states.delete(handle.id);
  }

  getResult(handle: RuntimeHandle): RuntimeResult | null {
    return this.states.get(handle.id)?.result ?? this.results.get(handle.id) ?? null;
  }

  private startTurn(
    handle: RuntimeHandle,
    state: TmuxState,
    phase: string,
    message: string,
  ): void {
    state.turnNumber += 1;
    state.pendingResume = null;
    state.currentTurnToken = `${handle.taskId}-${state.turnNumber}-${Date.now()}`;
    state.result = {
      ...state.result,
      exitStatus: "running",
      metrics: {
        ...state.result.metrics,
        finishedAt: undefined,
        durationMs: undefined,
        retryCount: state.turnNumber - 1,
      },
    };
    state.result = appendRuntimeLifecycleEvent(state.result, createRuntimeEventEnvelope({
      lifecycle: state.turnNumber === 1 ? "launch_started" : "resume_started",
      taskId: handle.taskId,
      correlationId: state.correlationId,
      agentName: handle.agentName,
      runtimeType: handle.runtimeType,
      runtimeId: handle.id,
      details: {
        phase,
        turnNumber: state.turnNumber,
      },
    }));
    this.results.set(handle.id, state.result);

    const messageFile = writeTurnMessage(
      join(state.workspaceRoot, "workspace", "runtime-turns"),
      handle.taskId,
      state.turnNumber,
      phase,
      message,
    );

    const command = [
      `printf '%s\\n' ${shellQuote(`__MAESTRO_TURN_START__:${state.currentTurnToken}`)}`,
      `${buildEnvPrefix(state.env)} ${shellQuote(process.execPath)} ${shellQuote(join(state.workspaceRoot, "dist", "src", "runtime", "pi-runner.js"))}`,
      `--cwd ${shellQuote(state.workspaceRoot)}`,
      `--session-file ${shellQuote(state.sessionFilePath)}`,
      `--prompt-file ${shellQuote(state.promptFilePath)}`,
      `--message-file ${shellQuote(messageFile)}`,
      `--model ${shellQuote(state.model)}`,
      `--tools ${shellQuote(state.allowedTools.join(","))}`,
      `--extension ${shellQuote(join(state.workspaceRoot, "dist", "src", "runtime", "maestro-policy-extension.js"))}`,
      `; code=$?; printf '%s\\n' ${shellQuote(`__MAESTRO_TURN_END__:${state.currentTurnToken}:`)}\"$code\"`,
    ].join(" ");

    appendRuntimeObservation(
      state.workspaceRoot,
      handle.agentName,
      `[tmux runtime] turn=${state.turnNumber} phase=${phase} model=${state.model} tools=${state.allowedTools.join(",") || "none"}`,
      {
        taskId: handle.taskId,
        correlationId: state.correlationId,
      },
    );
    this.manager.sendKeys(handle.id, command);
  }

  private runPendingResume(handle: RuntimeHandle, state: TmuxState): boolean {
    if (!state.pendingResume) return false;

    const pending = state.pendingResume;
    state.pendingResume = null;
    this.startTurn(handle, state, pending.phase, pending.message);
    return true;
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildEnvPrefix(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
    .join(" ");
}

function parseTurnExitCode(output: string, endMarker: string): number {
  const pattern = new RegExp(`${escapeRegExp(endMarker)}(\\d+)`);
  const match = output.match(pattern);
  const value = Number.parseInt(match?.[1] ?? "", 10);
  return Number.isInteger(value) ? value : 1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function launchMessage(params: AgentRuntimeLaunchParams): string {
  return [
    `Start task ${params.taskId} as ${params.agentName}.`,
    `Current phase: ${params.phase}.`,
    "The task is not complete until the task file includes a valid handoff report with all required sections.",
    "Read the task file first, then continue working until the task reaches a terminal state or you hit a concrete blocker.",
    "Do not stop after an intermediate progress update, scoping summary, or partial inspection.",
  ].join("\n");
}
