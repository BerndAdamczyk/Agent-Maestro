/**
 * Delegation Engine.
 * Reference: arc42 Section 5.2.1 (DelegationEngine), 6.1 (Full Delegation Flow)
 *
 * Creates task files, assembles prompts, spawns agents in tmux/containers,
 * tracks active workers. Enforces spawn budget and delegation depth limits.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { v4 as uuid } from "uuid";
import type {
  SystemConfig,
  ActiveWorker,
  DelegationParams,
  AgentDefinition,
  ExecutionIntentRecord,
  PersistedActiveWorker,
  RuntimePolicyManifest,
  TaskPhase,
} from "./types.js";
import type { AgentResolver } from "./config.js";
import type { PromptAssembler } from "./prompt-assembler.js";
import type { TaskManager } from "./task-manager.js";
import type { Logger } from "./logger.js";
import type { MemorySubsystem } from "./memory/index.js";
import { resolveModelPreset } from "./model-presets.js";
import { hasPiModelCredentials } from "./pi-runtime-support.js";
import type { AgentRuntime } from "./runtime/agent-runtime.js";
import { ExecutionIntentQueue } from "./runtime/intent-queue.js";
import { RuntimePolicyManager } from "./runtime/policy.js";
import { MaestroError, SpawnBudgetExhaustedError } from "./errors.js";
import { atomicWrite } from "./utils.js";
import { WorktreeManager } from "./worktree-manager.js";

export interface DelegationQueue {
  params: DelegationParams;
  queuedAt: Date;
}

export class DelegationEngine {
  private rootDir: string;
  private config: SystemConfig;
  private agentResolver: AgentResolver;
  private promptAssembler: PromptAssembler;
  private runtime: AgentRuntime;
  private taskManager: TaskManager;
  private logger: Logger;
  private memory: MemorySubsystem;
  private policyManager: RuntimePolicyManager;
  private activeWorkers = new Map<string, ActiveWorker>();
  private delegationQueue: DelegationQueue[] = [];
  private activeWorkerStatePath: string;
  private intentQueue: ExecutionIntentQueue;
  private worktreeManager: WorktreeManager;

  constructor(
    rootDir: string,
    config: SystemConfig,
    agentResolver: AgentResolver,
    promptAssembler: PromptAssembler,
    runtime: AgentRuntime,
    taskManager: TaskManager,
    logger: Logger,
    memory: MemorySubsystem,
  ) {
    this.rootDir = rootDir;
    this.config = config;
    this.agentResolver = agentResolver;
    this.promptAssembler = promptAssembler;
    this.runtime = runtime;
    this.taskManager = taskManager;
    this.logger = logger;
    this.memory = memory;
    this.policyManager = new RuntimePolicyManager(rootDir, config);
    this.worktreeManager = new WorktreeManager(rootDir, config);
    this.activeWorkerStatePath = join(rootDir, config.paths.workspace, "runtime-state", "active-workers.json");
    const workspaceDir = join(rootDir, config.paths.workspace);
    mkdirSync(join(workspaceDir, "runtime-state"), { recursive: true });
    this.intentQueue = new ExecutionIntentQueue(workspaceDir);
  }

  /**
   * Delegate a task to an agent.
   * Creates task file, assembles prompt, spawns agent process.
   */
  async delegate(params: DelegationParams): Promise<ActiveWorker> {
    const existingWorker = this.activeWorkers.get(params.taskId);
    if (existingWorker) {
      return existingWorker;
    }

    // Depth guard
    if (params.delegationDepth > this.config.limits.max_delegation_depth) {
      throw new MaestroError(
        "DELEGATION_DEPTH_EXCEEDED",
        `Delegation depth ${params.delegationDepth} exceeds max ${this.config.limits.max_delegation_depth}`,
        {
          details: {
            taskId: params.taskId,
            delegationDepth: params.delegationDepth,
            maxDelegationDepth: this.config.limits.max_delegation_depth,
          },
        },
      );
    }

    // Resolve agent definition
    const agent = this.agentResolver.findAgentByName(params.agentName);
    if (!agent) {
      throw new MaestroError("AGENT_NOT_FOUND", `Agent not found: ${params.agentName}`, {
        details: {
          taskId: params.taskId,
          agentName: params.agentName,
        },
      });
    }

    // Check agent has delegate capability (if needed)
    // Workers don't need delegate, they're being delegated TO

    const task = this.taskManager.readTask(params.taskId) ?? this.taskManager.createTask({
      taskId: params.taskId,
      title: params.taskTitle,
      description: params.taskDescription,
      assignedTo: params.agentName,
      taskType: params.taskType,
      acceptanceCriteria: params.acceptanceCriteria,
      wave: params.wave,
      dependencies: params.dependencies,
      parentTask: params.parentTaskId,
      planFirst: params.planFirst,
      timeBudget: params.timeBudget,
    });
    const launchIntent = this.intentQueue.enqueueLaunch(params, task.correlationId);

    // Spawn budget check
    if (!this.runtime.hasCapacity()) {
      this.logger.logEntry("Maestro", `Queuing delegation for '${params.agentName}' -- spawn budget full`, {
        level: "warn",
        taskId: task.id,
        correlationId: task.correlationId,
      });
      this.enqueueDelegation(params);
      throw new SpawnBudgetExhaustedError({
        taskId: task.id,
        correlationId: task.correlationId,
        agentName: params.agentName,
      });
    }

    // Initialize session DAG (Level 1 memory)
    this.memory.sessionDAG.createSession(task.id);
    this.memory.sessionDAG.append(task.id, {
      role: "system",
      tool: "delegate",
      content: `Delegated ${task.id} to ${params.agentName} for wave ${params.wave}. Correlation ID: ${task.correlationId}`,
      parentId: null,
    });

    // Ensure agent memory directories exist
    this.memory.expertise.ensureAgentMemory(params.agentName);

    // Assemble full prompt
    const prompt = this.promptAssembler.assemble(agent, {
      ...params,
      taskId: task.id,
    });
    const allowedTools = this.getAllowedTools(agent);
    const role = this.agentResolver.getAgentRole(params.agentName);
    const policy = this.policyManager.build({
      taskId: task.id,
      agentName: params.agentName,
      role,
      phase: task.phase,
      taskFilePath: this.taskManager.getTaskFilePath(task.id),
      allowedTools,
      domain: agent.frontmatter.domain,
      taskWriteScope: task.writeScope,
    });
    const model = this.pickLaunchModel(agent);
    const workspaceAllocation = this.worktreeManager.allocate(task.id, task.writeScope);
    this.intentQueue.markInProgress(launchIntent.id);
    let runtimeHandle;
    try {
      runtimeHandle = this.runtime.launch({
        agentName: params.agentName,
        taskId: task.id,
        correlationId: task.correlationId,
        role,
        phase: task.phase,
        model,
        systemPrompt: prompt,
        promptFilePath: policy.promptFilePath,
        taskFilePath: this.taskManager.getTaskFilePath(task.id),
        sessionFilePath: policy.sessionFilePath,
        policyManifestPath: this.policyManager.getPolicyManifestPath(task.id),
        workspaceRoot: workspaceAllocation.rootDir,
        allowedTools: policy.allowedTools,
        timeoutMs: params.timeBudget * 1000,
        env: {
          MAESTRO_TASK_ID: task.id,
          MAESTRO_AGENT_NAME: params.agentName,
          ...(workspaceAllocation.isolated ? { MAESTRO_WORKTREE_ROOT: workspaceAllocation.rootDir } : {}),
        },
      });
    } catch (error) {
      this.intentQueue.markFailed(launchIntent.id, error);
      if (workspaceAllocation.isolated) {
        this.worktreeManager.finalize(task.id, "failed");
      }
      throw error;
    }
    this.intentQueue.markCompleted(launchIntent.id, {
      runtimeId: runtimeHandle.id,
      runtimeType: runtimeHandle.runtimeType,
      note: "Runtime launch persisted successfully",
    });
    this.memory.sessionDAG.append(task.id, {
      role: "assistant",
      content: `Runtime launched via ${runtimeHandle.runtimeType} with handle ${runtimeHandle.id}.`,
    });

    // Track active worker
    const now = new Date();
    const worker: ActiveWorker = {
      instanceId: uuid(),
      agentName: params.agentName,
      runtimeId: runtimeHandle.id,
      runtimeType: runtimeHandle.runtimeType,
      runtimeHandle,
      taskId: task.id,
      correlationId: task.correlationId,
      role: this.agentResolver.getAgentRole(params.agentName),
      hierarchyLevel: params.delegationDepth + 1,
      startedAt: now,
      lastOutputAt: now,
      parentTaskId: params.parentTaskId,
    };

    this.activeWorkers.set(task.id, worker);
    this.persistActiveWorkers();

    this.logger.logEntry(
      "Maestro",
      `Delegated ${task.id} "${params.taskTitle}" to ${params.agentName} (${runtimeHandle.runtimeType}: ${runtimeHandle.id}, wave: ${params.wave}, model: ${model})`,
      {
        taskId: task.id,
        correlationId: task.correlationId,
      }
    );

    // Update task status
    this.taskManager.updateStatus(task.id, "in_progress");

    return worker;
  }

  /**
   * Process queued delegations when capacity becomes available.
   */
  processQueue(): DelegationParams | null {
    if (this.delegationQueue.length === 0) return null;
    if (!this.runtime.hasCapacity()) return null;

    const next = this.delegationQueue.shift()!;
    return next.params;
  }

  replayPendingDelegations(taskIds?: string[]): DelegationParams[] {
    const tasks = new Map(
      this.taskManager
        .getAllTasks()
        .filter(task => !taskIds || taskIds.includes(task.id))
        .map(task => [task.id, task] as const),
    );
    const replayable = this.intentQueue.replayPendingLaunches({
      tasks,
      activeWorkers: this.activeWorkers,
    });
    const newlyQueued: DelegationParams[] = [];

    for (const params of replayable) {
      if (this.enqueueDelegation(params)) {
        newlyQueued.push(params);
      }
    }

    return newlyQueued;
  }

  /**
   * Mark a worker as completed and clean up.
   */
  completeWorker(taskId: string, outcome: "complete" | "failed" | "interrupted" = "complete"): void {
    const worker = this.activeWorkers.get(taskId);
    if (!worker) return;

    this.runtime.destroy(worker.runtimeHandle);
    this.worktreeManager.finalize(taskId, outcome);
    this.activeWorkers.delete(taskId);
    this.persistActiveWorkers();

    const verb = outcome === "complete"
      ? "completed"
      : outcome === "failed"
        ? "failed"
        : "stopped";

    this.logger.logEntry("Maestro", `Worker ${verb}: ${taskId} (${worker.agentName})`, {
      taskId,
      correlationId: worker.correlationId,
    });
  }

  private getAllowedTools(agent: AgentDefinition): string[] {
    const supportedPiTools = new Set(["read", "write", "edit", "bash"]);
    return Object.entries(agent.frontmatter.tools)
      .filter(([tool, allowed]) => allowed && supportedPiTools.has(tool))
      .map(([tool]) => tool);
  }

  private pickLaunchModel(agent: AgentDefinition): string {
    const tierPolicy = this.config.model_tier_policy[agent.frontmatter.model_tier];
    const activePreset = resolveModelPreset(process.env["MAESTRO_MODEL_PRESET"]);
    const candidates = [
      tierPolicy.primary,
      tierPolicy.fallback,
      ...(activePreset ? [] : [agent.frontmatter.model]),
    ];
    const uniqueCandidates = [...new Set(candidates.filter(Boolean))];

    const selected = uniqueCandidates.find(model => hasPiModelCredentials(model))
      ?? uniqueCandidates[0]
      ?? agent.frontmatter.model;

    if (selected !== agent.frontmatter.model) {
      this.logger.logEntry(
        "Delegation",
        `Switching ${agent.frontmatter.name} from ${agent.frontmatter.model} to ${selected} based on available Pi credentials`,
        { level: "warn" },
      );
    }

    return selected;
  }

  getPersistedActiveWorkers(): PersistedActiveWorker[] {
    if (!existsSync(this.activeWorkerStatePath)) {
      return [];
    }

    try {
      return JSON.parse(readFileSync(this.activeWorkerStatePath, "utf-8")) as PersistedActiveWorker[];
    } catch {
      return [];
    }
  }

  destroyAllActiveWorkers(reason: string): void {
    for (const [taskId, worker] of this.activeWorkers) {
      this.logger.logEntry("Maestro", `Destroying active worker during shutdown: ${taskId} (${worker.agentName}) -- ${reason}`, {
        level: "warn",
        taskId,
        correlationId: worker.correlationId,
      });
      this.runtime.destroy(worker.runtimeHandle);
      this.activeWorkers.delete(taskId);
    }
    this.persistActiveWorkers();
  }

  clearPersistedActiveWorkers(): void {
    atomicWrite(this.activeWorkerStatePath, JSON.stringify([], null, 2));
  }

  getActiveWorkers(): Map<string, ActiveWorker> {
    return this.activeWorkers;
  }

  getActiveWorker(taskId: string): ActiveWorker | undefined {
    return this.activeWorkers.get(taskId);
  }

  refreshWorkerRuntimeContext(taskId: string, phase: TaskPhase): (RuntimePolicyManifest & { policyManifestPath: string }) | null {
    const worker = this.activeWorkers.get(taskId);
    if (!worker) return null;

    const task = this.taskManager.readTask(taskId);
    if (!task) return null;

    const agent = this.agentResolver.findAgentByName(worker.agentName);
    if (!agent) return null;

    this.promptAssembler.assemble(agent, {
      agentName: worker.agentName,
      taskId: task.id,
      taskTitle: task.title,
      taskDescription: task.description,
      taskType: task.taskType,
      acceptanceCriteria: task.acceptanceCriteria,
      phase,
      wave: task.wave,
      dependencies: task.dependencies,
      planFirst: task.planFirst,
      timeBudget: task.timeBudget,
      parentTaskId: task.parentTask,
      delegationDepth: Math.max(0, worker.hierarchyLevel - 1),
    });

    const allowedTools = this.getAllowedTools(agent);
    const manifest = this.policyManager.build({
      taskId: task.id,
      agentName: worker.agentName,
      role: worker.role,
      phase,
      taskFilePath: this.taskManager.getTaskFilePath(task.id),
      allowedTools,
      domain: agent.frontmatter.domain,
      taskWriteScope: task.writeScope,
    });

    return {
      ...manifest,
      policyManifestPath: this.policyManager.getPolicyManifestPath(task.id),
    };
  }

  getQueueLength(): number {
    return this.delegationQueue.length;
  }

  getPersistedExecutionIntents(): ExecutionIntentRecord[] {
    return this.intentQueue.list();
  }

  private enqueueDelegation(params: DelegationParams): boolean {
    const alreadyQueued = this.delegationQueue.some(entry => entry.params.taskId === params.taskId);
    if (alreadyQueued) {
      return false;
    }

    this.delegationQueue.push({ params, queuedAt: new Date() });
    return true;
  }

  private persistActiveWorkers(): void {
    const persisted: PersistedActiveWorker[] = [...this.activeWorkers.values()].map(worker => ({
      instanceId: worker.instanceId,
      agentName: worker.agentName,
      runtimeId: worker.runtimeId,
      runtimeType: worker.runtimeType,
      taskId: worker.taskId,
      correlationId: worker.correlationId,
      role: worker.role,
      hierarchyLevel: worker.hierarchyLevel,
      startedAt: worker.startedAt.toISOString(),
      lastOutputAt: worker.lastOutputAt.toISOString(),
      parentTaskId: worker.parentTaskId,
    }));

    atomicWrite(this.activeWorkerStatePath, JSON.stringify(persisted, null, 2));
  }
}
