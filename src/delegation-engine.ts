/**
 * Delegation Engine.
 * Reference: arc42 Section 5.2.1 (DelegationEngine), 6.1 (Full Delegation Flow)
 *
 * Creates task files, assembles prompts, spawns agents in tmux/containers,
 * tracks active workers. Enforces spawn budget and delegation depth limits.
 */

import { v4 as uuid } from "uuid";
import type {
  SystemConfig,
  ActiveWorker,
  DelegationParams,
  AgentDefinition,
} from "./types.js";
import type { AgentResolver } from "./config.js";
import type { PromptAssembler } from "./prompt-assembler.js";
import type { TaskManager } from "./task-manager.js";
import type { Logger } from "./logger.js";
import type { MemorySubsystem } from "./memory/index.js";
import type { AgentRuntime } from "./runtime/agent-runtime.js";

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
  private activeWorkers = new Map<string, ActiveWorker>();
  private delegationQueue: DelegationQueue[] = [];

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
  }

  /**
   * Delegate a task to an agent.
   * Creates task file, assembles prompt, spawns agent process.
   */
  async delegate(params: DelegationParams): Promise<ActiveWorker> {
    // Depth guard
    if (params.delegationDepth > this.config.limits.max_delegation_depth) {
      throw new Error(
        `Delegation depth ${params.delegationDepth} exceeds max ${this.config.limits.max_delegation_depth}`
      );
    }

    // Resolve agent definition
    const agent = this.agentResolver.findAgentByName(params.agentName);
    if (!agent) {
      throw new Error(`Agent not found: ${params.agentName}`);
    }

    // Check agent has delegate capability (if needed)
    // Workers don't need delegate, they're being delegated TO

    // Spawn budget check
    if (!this.runtime.hasCapacity()) {
      this.logger.logEntry("Maestro", `Queuing delegation for '${params.agentName}' -- spawn budget full`);
      this.delegationQueue.push({ params, queuedAt: new Date() });
      throw new Error("Spawn budget exhausted, delegation queued");
    }

    // Create task file
    const task = this.taskManager.createTask({
      title: params.taskTitle,
      description: params.taskDescription,
      assignedTo: params.agentName,
      wave: params.wave,
      dependencies: params.dependencies,
      parentTask: params.parentTaskId,
      planFirst: params.planFirst,
      timeBudget: params.timeBudget,
    });

    // Override task ID if pre-assigned
    if (params.taskId && params.taskId !== task.id) {
      // Use the pre-assigned ID (for fix-tasks etc.)
    }

    // Initialize session DAG (Level 1 memory)
    this.memory.sessionDAG.createSession(task.id);

    // Ensure agent memory directories exist
    this.memory.expertise.ensureAgentMemory(params.agentName);

    // Assemble full prompt
    const prompt = this.promptAssembler.assemble(agent, {
      ...params,
      taskId: task.id,
    });

    const runtimeHandle = this.runtime.launch({
      agentName: params.agentName,
      taskId: task.id,
      systemPrompt: prompt,
      taskFilePath: this.taskManager.getTaskFilePath(task.id),
      workspaceRoot: this.rootDir,
      allowedTools: this.getAllowedTools(agent),
      timeoutMs: params.timeBudget * 1000,
      env: {
        MAESTRO_TASK_ID: task.id,
        MAESTRO_AGENT_NAME: params.agentName,
      },
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
      role: this.agentResolver.getAgentRole(params.agentName),
      hierarchyLevel: params.delegationDepth + 1,
      startedAt: now,
      lastOutputAt: now,
      parentTaskId: params.parentTaskId,
    };

    this.activeWorkers.set(task.id, worker);

    this.logger.logEntry(
      "Maestro",
      `Delegated ${task.id} "${params.taskTitle}" to ${params.agentName} (${runtimeHandle.runtimeType}: ${runtimeHandle.id}, wave: ${params.wave})`
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

  /**
   * Mark a worker as completed and clean up.
   */
  completeWorker(taskId: string): void {
    const worker = this.activeWorkers.get(taskId);
    if (!worker) return;

    this.runtime.destroy(worker.runtimeHandle);
    this.activeWorkers.delete(taskId);

    this.logger.logEntry("Maestro", `Worker completed: ${taskId} (${worker.agentName})`);
  }

  private getAllowedTools(agent: AgentDefinition): string[] {
    return Object.entries(agent.frontmatter.tools)
      .filter(([, allowed]) => allowed)
      .map(([tool]) => tool);
  }

  getActiveWorkers(): Map<string, ActiveWorker> {
    return this.activeWorkers;
  }

  getActiveWorker(taskId: string): ActiveWorker | undefined {
    return this.activeWorkers.get(taskId);
  }

  getQueueLength(): number {
    return this.delegationQueue.length;
  }
}
