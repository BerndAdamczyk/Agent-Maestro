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
  ParsedTask,
} from "./types.js";
import type { AgentResolver } from "./config.js";
import type { PromptAssembler } from "./prompt-assembler.js";
import type { RuntimeManager } from "./runtime-manager.js";
import type { TaskManager } from "./task-manager.js";
import type { Logger } from "./logger.js";
import type { MemorySubsystem } from "./memory/index.js";

export interface DelegationQueue {
  params: DelegationParams;
  queuedAt: Date;
}

export class DelegationEngine {
  private config: SystemConfig;
  private agentResolver: AgentResolver;
  private promptAssembler: PromptAssembler;
  private runtimeManager: RuntimeManager;
  private taskManager: TaskManager;
  private logger: Logger;
  private memory: MemorySubsystem;
  private activeWorkers = new Map<string, ActiveWorker>();
  private delegationQueue: DelegationQueue[] = [];

  constructor(
    config: SystemConfig,
    agentResolver: AgentResolver,
    promptAssembler: PromptAssembler,
    runtimeManager: RuntimeManager,
    taskManager: TaskManager,
    logger: Logger,
    memory: MemorySubsystem,
  ) {
    this.config = config;
    this.agentResolver = agentResolver;
    this.promptAssembler = promptAssembler;
    this.runtimeManager = runtimeManager;
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
    if (!this.runtimeManager.hasCapacity()) {
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

    // Spawn agent in runtime
    const paneId = this.runtimeManager.createPane(params.agentName);

    // Build the agent launch command
    // In dev mode, we pipe the prompt to the agent runtime
    const promptFile = `memory/sessions/prompt-${task.id}.md`;
    const logFile = `logs/${this.slugify(params.agentName)}.log`;
    const launchCmd = this.buildLaunchCommand(params.agentName, promptFile, logFile, task.id);

    this.runtimeManager.sendKeys(paneId, launchCmd);

    // Track active worker
    const now = new Date();
    const worker: ActiveWorker = {
      instanceId: uuid(),
      agentName: params.agentName,
      runtimeId: paneId,
      runtimeType: "tmux",
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
      `Delegated ${task.id} "${params.taskTitle}" to ${params.agentName} (pane: ${paneId}, wave: ${params.wave})`
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
    if (!this.runtimeManager.hasCapacity()) return null;

    const next = this.delegationQueue.shift()!;
    return next.params;
  }

  /**
   * Mark a worker as completed and clean up.
   */
  completeWorker(taskId: string): void {
    const worker = this.activeWorkers.get(taskId);
    if (!worker) return;

    // Clean up runtime
    this.runtimeManager.destroyPane(worker.runtimeId);
    this.runtimeManager.releasePaneId(worker.runtimeId);
    this.activeWorkers.delete(taskId);

    this.logger.logEntry("Maestro", `Worker completed: ${taskId} (${worker.agentName})`);
  }

  /**
   * Build the command to launch an agent in its runtime.
   * This creates a command that a coding-agent framework can execute.
   */
  private buildLaunchCommand(agentName: string, promptFile: string, logFile: string, taskId: string): string {
    // The agent runtime command -- this is where the coding agent framework integration happens.
    // For now, we use a generic approach that can work with various agent runtimes.
    // The prompt file contains the full system prompt.
    return `echo "Agent ${agentName} starting task ${taskId}..." && cat ${promptFile} | head -5 && echo "--- Agent runtime placeholder: integrate with Pi or similar framework ---"`;
  }

  private slugify(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
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
