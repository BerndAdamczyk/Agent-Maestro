/**
 * Docker-backed worker runtime with bind-mount authority isolation.
 * Reference: arc42 Sections 7, 8.5, 8.12
 */

import { execFileSync, spawn, type ChildProcessByStdio } from "node:child_process";
import { readFileSync } from "node:fs";
import path, { join } from "node:path";
import type { Readable } from "node:stream";
import type {
  AgentRuntimeLaunchParams,
  AgentRuntimeResumeParams,
  RuntimeHandle,
  RuntimePolicyManifest,
  RuntimeResult,
} from "../types.js";
import type { AgentRuntime } from "./agent-runtime.js";
import { getForwardedProviderEnv, resolvePiAgentDir } from "../pi-runtime-support.js";
import { appendRuntimeObservation } from "./runtime-log.js";
import { finalizeRuntimeResult, splitLines, writeTurnMessage } from "./pi-runtime-common.js";

interface ContainerState {
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
  piAgentDir: string | null;
  turnNumber: number;
  containerName: string | null;
  pendingResume: AgentRuntimeResumeParams | null;
  correlationId: string | null;
}

export class ContainerAgentRuntime implements AgentRuntime {
  private nextId = 1;
  private maxConcurrent: number;
  private imageName: string;
  private ensuredImage = false;
  private containers = new Map<string, ContainerState>();
  private results = new Map<string, RuntimeResult>();

  constructor(maxConcurrent: number, imageName: string = "agent-maestro-worker:pi-v1") {
    this.maxConcurrent = maxConcurrent;
    this.imageName = imageName;
  }

  ensureReady(): void {
    if (this.ensuredImage) return;

    try {
      execFileSync("docker", ["image", "inspect", this.imageName], { stdio: "ignore" });
    } catch {
      execFileSync(
        "docker",
        ["build", "-t", this.imageName, "-f", "docker/worker-runtime.Dockerfile", "."],
        {
          cwd: process.cwd(),
          stdio: "inherit",
        },
      );
    }

    this.ensuredImage = true;
  }

  hasCapacity(): boolean {
    return [...this.containers.values()].filter(state => state.child !== null).length < this.maxConcurrent;
  }

  launch(params: AgentRuntimeLaunchParams): RuntimeHandle {
    this.ensureReady();

    const id = `ctr-${String(this.nextId++).padStart(3, "0")}`;
    const startedAt = new Date().toISOString();

    const handle: RuntimeHandle = {
      id,
      runtimeType: "container",
      agentName: params.agentName,
      taskId: params.taskId,
      launchedAt: startedAt,
    };

    const hostPiAgentDir = resolvePiAgentDir();
    const containerPiAgentDir = hostPiAgentDir ? "/tmp/pi-agent" : null;

    const state: ContainerState = {
      child: null,
      workspaceRoot: params.workspaceRoot,
      output: [],
      promptFilePath: params.promptFilePath,
      sessionFilePath: params.sessionFilePath,
      policyManifestPath: params.policyManifestPath,
      model: params.model,
      allowedTools: params.allowedTools,
      env: {
        ...getForwardedProviderEnv(),
        ...params.env,
        ...(containerPiAgentDir ? { PI_CODING_AGENT_DIR: containerPiAgentDir } : {}),
        MAESTRO_POLICY_PATH: toContainerPath(path.relative(params.workspaceRoot, params.policyManifestPath)),
      },
      piAgentDir: hostPiAgentDir,
      turnNumber: 0,
      containerName: null,
      pendingResume: null,
      correlationId: params.correlationId ?? null,
      result: {
        exitStatus: "running",
        handoffReportPath: params.taskFilePath,
        artifacts: [
          {
            path: params.taskFilePath,
            type: "task-file",
            description: "Task coordination file tracked by the container runtime.",
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

    this.containers.set(id, state);
    this.results.set(id, state.result);
    this.startTurn(handle, state, params.phase, launchMessage(params));
    return handle;
  }

  resume(handle: RuntimeHandle, params: AgentRuntimeResumeParams): void {
    const state = this.containers.get(handle.id);
    if (!state) return;
    if (params.allowedTools) {
      state.allowedTools = [...params.allowedTools];
    }
    if (this.isAlive(handle)) {
      state.pendingResume = params;
      return;
    }
    state.pendingResume = null;
    this.startTurn(handle, state, params.phase, params.message);
  }

  isAlive(handle: RuntimeHandle): boolean {
    const state = this.containers.get(handle.id);
    if (!state?.child) return false;
    return state.child.exitCode === null && !state.child.killed;
  }

  getOutput(handle: RuntimeHandle, lines: number = 200): string {
    const state = this.containers.get(handle.id);
    if (!state) return "";
    return state.output.slice(-lines).join("\n");
  }

  interrupt(handle: RuntimeHandle, reason: string): void {
    const state = this.containers.get(handle.id);
    if (!state) return;

    state.pendingResume = null;
    appendRuntimeObservation(state.workspaceRoot, handle.agentName, `[container runtime] interrupt: ${reason}`, {
      taskId: handle.taskId,
      correlationId: state.correlationId,
    });
    if (state.containerName) {
      try {
        execFileSync("docker", ["kill", state.containerName], { stdio: "ignore" });
      } catch {
        // Container may have already stopped.
      }
    }
    state.result = finalizeRuntimeResult(state.result, "interrupted");
    this.results.set(handle.id, state.result);
  }

  destroy(handle: RuntimeHandle): void {
    const state = this.containers.get(handle.id);
    if (!state) return;

    state.pendingResume = null;
    if (state.containerName) {
      try {
        execFileSync("docker", ["rm", "-f", state.containerName], { stdio: "ignore" });
      } catch {
        // Container may have already exited.
      }
    }

    if (state.result.exitStatus === "running") {
      state.result = finalizeRuntimeResult(state.result, "interrupted");
      this.results.set(handle.id, state.result);
    }

    state.child = null;
    state.containerName = null;
    this.containers.delete(handle.id);
  }

  getResult(handle: RuntimeHandle): RuntimeResult | null {
    return this.containers.get(handle.id)?.result ?? this.results.get(handle.id) ?? null;
  }

  private startTurn(
    handle: RuntimeHandle,
    state: ContainerState,
    phase: string,
    message: string,
  ): void {
    state.turnNumber += 1;
    state.pendingResume = null;
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
    this.results.set(handle.id, state.result);

    const messageFile = writeTurnMessage(
      join(state.workspaceRoot, "workspace", "runtime-turns"),
      handle.taskId,
      state.turnNumber,
      phase,
      message,
    );

    const policy = JSON.parse(readFileSync(state.policyManifestPath, "utf-8")) as RuntimePolicyManifest;
    const containerName = `agent-maestro-${handle.taskId}-${state.turnNumber}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
    state.containerName = containerName;

    const repoMountMode = policy.writeRoots.includes(".") ? "rw" : "ro";
    const dockerArgs = [
      "run",
      "--rm",
      "--name",
      containerName,
      "--workdir",
      "/workspace/repo",
      "--read-only",
      "--tmpfs",
      "/tmp:exec,mode=1777",
      "--pids-limit",
      "512",
      "--cpus",
      "4",
      "--memory",
      "8g",
      "--security-opt",
      "no-new-privileges:true",
      "--cap-drop",
      "ALL",
      ...(typeof process.getuid === "function" && typeof process.getgid === "function"
        ? ["--user", `${process.getuid()}:${process.getgid()}`]
        : []),
      "-v",
      `${state.workspaceRoot}:/workspace/repo:${repoMountMode}`,
      ...buildWritableMountArgs(state.workspaceRoot, policy.writeRoots),
      ...buildPiAgentMountArgs(state.piAgentDir),
      ...buildEnvArgs(state.env),
      this.imageName,
      "bash",
      "-lc",
      buildContainerRunnerCommand(state, messageFile),
    ];

    const child = spawn("docker", dockerArgs, {
      cwd: state.workspaceRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    state.child = child;

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      state.output.push(...splitLines(text));
      appendRuntimeObservation(state.workspaceRoot, handle.agentName, text, {
        taskId: handle.taskId,
        correlationId: state.correlationId,
      });
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      state.output.push(...splitLines(text));
      appendRuntimeObservation(state.workspaceRoot, handle.agentName, `[stderr] ${text}`, {
        taskId: handle.taskId,
        correlationId: state.correlationId,
      });
    });

    child.on("exit", code => {
      state.child = null;
      state.containerName = null;
      state.result = finalizeRuntimeResult(state.result, code === 0 ? "completed" : "failed");
      this.results.set(handle.id, state.result);

      this.runPendingResume(handle, state);
    });

    appendRuntimeObservation(
      state.workspaceRoot,
      handle.agentName,
      `[container runtime] turn=${state.turnNumber} phase=${phase} model=${state.model} tools=${state.allowedTools.join(",") || "none"} image=${this.imageName}`,
      {
        taskId: handle.taskId,
        correlationId: state.correlationId,
      },
    );
  }

  private runPendingResume(handle: RuntimeHandle, state: ContainerState): boolean {
    if (!state.pendingResume) return false;

    const pending = state.pendingResume;
    state.pendingResume = null;
    this.startTurn(handle, state, pending.phase, pending.message);
    return true;
  }
}

function buildWritableMountArgs(rootDir: string, writeRoots: string[]): string[] {
  return writeRoots
    .filter(root => root !== ".")
    .flatMap(root => [
      "-v",
      `${join(rootDir, root)}:${toContainerPath(root)}:rw`,
    ]);
}

function buildEnvArgs(env: Record<string, string>): string[] {
  return Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]);
}

function buildPiAgentMountArgs(hostPiAgentDir: string | null): string[] {
  if (!hostPiAgentDir) {
    return [];
  }

  return [
    "-v",
    `${hostPiAgentDir}:/run/maestro/pi-agent:ro`,
  ];
}

function toContainerPath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized === "." || normalized === "") {
    return "/workspace/repo";
  }
  return path.posix.join("/workspace/repo", normalized);
}

function buildContainerRunnerCommand(state: ContainerState, messageFile: string): string {
  const copyPiAgentDir = state.piAgentDir
    ? "mkdir -p /tmp/pi-agent && cp -a /run/maestro/pi-agent/. /tmp/pi-agent/ 2>/dev/null || true"
    : "";

  const runnerArgs = [
    "node",
    "/workspace/repo/dist/src/runtime/pi-runner.js",
    "--cwd",
    "/workspace/repo",
    "--session-file",
    toContainerPath(path.relative(state.workspaceRoot, state.sessionFilePath)),
    "--prompt-file",
    toContainerPath(path.relative(state.workspaceRoot, state.promptFilePath)),
    "--message-file",
    toContainerPath(path.relative(state.workspaceRoot, messageFile)),
    "--model",
    state.model,
    "--tools",
    state.allowedTools.join(","),
    "--extension",
    "/workspace/repo/dist/src/runtime/maestro-policy-extension.js",
  ];

  const runnerCommand = runnerArgs.map(shellQuote).join(" ");
  return [copyPiAgentDir, `exec ${runnerCommand}`]
    .filter(Boolean)
    .join(" && ");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
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
