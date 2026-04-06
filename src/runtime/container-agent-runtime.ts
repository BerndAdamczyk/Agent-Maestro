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
  turnNumber: number;
  containerName: string | null;
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
        ...params.env,
        MAESTRO_POLICY_PATH: toContainerPath(path.relative(params.workspaceRoot, params.policyManifestPath)),
      },
      turnNumber: 0,
      containerName: null,
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
    if (!state || this.isAlive(handle)) return;
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

    appendRuntimeObservation(state.workspaceRoot, handle.agentName, `[container runtime] interrupt: ${reason}`);
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
      ...buildEnvArgs(state.env),
      this.imageName,
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
      "/workspace/repo/.pi/extensions/maestro-policy.ts",
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
      appendRuntimeObservation(state.workspaceRoot, handle.agentName, text);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      state.output.push(...splitLines(text));
      appendRuntimeObservation(state.workspaceRoot, handle.agentName, `[stderr] ${text}`);
    });

    child.on("exit", code => {
      state.child = null;
      state.containerName = null;
      state.result = finalizeRuntimeResult(state.result, code === 0 ? "completed" : "failed");
      this.results.set(handle.id, state.result);
    });

    appendRuntimeObservation(
      state.workspaceRoot,
      handle.agentName,
      `[container runtime] turn=${state.turnNumber} phase=${phase} model=${state.model} tools=${state.allowedTools.join(",") || "none"} image=${this.imageName}`,
    );
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

function toContainerPath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized === "." || normalized === "") {
    return "/workspace/repo";
  }
  return path.posix.join("/workspace/repo", normalized);
}

function launchMessage(params: AgentRuntimeLaunchParams): string {
  return [
    `Start task ${params.taskId} as ${params.agentName}.`,
    `Current phase: ${params.phase}.`,
    "Read the task file first, then execute only the work required for this turn.",
  ].join("\n");
}
