/**
 * Deterministic wave orchestration.
 * Reference: arc42 Sections 6.1, 6.3, 6.6, 8.8
 */

import type { AgentResolver } from "./config.js";
import type { DelegationEngine } from "./delegation-engine.js";
import type { Logger } from "./logger.js";
import type { MemorySubsystem } from "./memory/index.js";
import type { MonitorEngine } from "./monitor-engine.js";
import type { ReconcileEngine } from "./reconcile-engine.js";
import type { StatusManager } from "./status-manager.js";
import type { TaskManager } from "./task-manager.js";
import type { TaskPlanProvider } from "./task-plan-provider.js";
import { TaskPlanService, sortResolvedTasks } from "./task-plan.js";
import type {
  ParsedTask,
  ResolvedTaskPlan,
  SessionState,
  SystemConfig,
} from "./types.js";
import type { AgentRuntime } from "./runtime/agent-runtime.js";

export class OrchestrationEngine {
  private rootDir: string;
  private config: SystemConfig;
  private session: SessionState;
  private agentResolver: AgentResolver;
  private taskPlanService: TaskPlanService;
  private taskPlanProvider: TaskPlanProvider;
  private taskManager: TaskManager;
  private delegationEngine: DelegationEngine;
  private monitorEngine: MonitorEngine;
  private reconcileEngine: ReconcileEngine;
  private statusManager: StatusManager;
  private logger: Logger;
  private memory: MemorySubsystem;
  private runtime: AgentRuntime;

  constructor(params: {
    rootDir: string;
    config: SystemConfig;
    session: SessionState;
    agentResolver: AgentResolver;
    taskPlanService: TaskPlanService;
    taskPlanProvider: TaskPlanProvider;
    taskManager: TaskManager;
    delegationEngine: DelegationEngine;
    monitorEngine: MonitorEngine;
    reconcileEngine: ReconcileEngine;
    statusManager: StatusManager;
    logger: Logger;
    memory: MemorySubsystem;
    runtime: AgentRuntime;
  }) {
    this.rootDir = params.rootDir;
    this.config = params.config;
    this.session = params.session;
    this.agentResolver = params.agentResolver;
    this.taskPlanService = params.taskPlanService;
    this.taskPlanProvider = params.taskPlanProvider;
    this.taskManager = params.taskManager;
    this.delegationEngine = params.delegationEngine;
    this.monitorEngine = params.monitorEngine;
    this.reconcileEngine = params.reconcileEngine;
    this.statusManager = params.statusManager;
    this.logger = params.logger;
    this.memory = params.memory;
    this.runtime = params.runtime;
  }

  async run(goal: string): Promise<void> {
    const plan = this.loadOrGeneratePlan(goal);
    this.taskPlanService.materialize(plan, this.taskManager);
    this.statusManager.refresh();

    const maxWave = Math.max(...plan.tasks.map(task => task.wave));
    this.logger.logEntry(
      "Maestro",
      `Loaded ${plan.tasks.length} planned tasks across ${maxWave} waves from ${plan.source}`,
      { level: "info" },
    );

    for (let wave = 1; wave <= maxWave; wave++) {
      const waveTasks = sortResolvedTasks(plan.tasks).filter(task => task.wave === wave);
      if (waveTasks.length === 0) continue;

      if (this.areTasksTerminal(waveTasks.map(task => task.id))) {
        this.session.currentWave = wave;
        continue;
      }

      this.session.currentWave = wave;
      this.logger.logEntry("Maestro", `Starting wave ${wave} with ${waveTasks.length} task(s)`, {
        level: "info",
      });

      const completed = await this.waitForTasks(
        waveTasks.map(task => task.id),
        this.config.limits.wave_timeout_seconds,
        `wave ${wave}`,
      );

      if (!completed) {
        this.session.status = "failed";
        throw new Error(`Wave ${wave} exceeded the configured timeout`);
      }

      this.statusManager.refresh();

      try {
        this.memory.gitCheckpoint.waveCheckpoint(wave);
      } catch {
        // Git checkpointing is best-effort.
      }

      if (plan.validation_commands.length > 0) {
        const reconciled = await this.runReconciliationLoop(wave, plan.validation_commands);
        if (!reconciled) {
          this.session.status = "failed";
          throw new Error(`Reconciliation failed after wave ${wave}`);
        }
      }
    }
  }

  private loadOrGeneratePlan(goal: string): ResolvedTaskPlan {
    if (this.taskPlanService.hasAuthoritativePlan()) {
      return this.taskPlanService.loadAuthoritativePlan();
    }

    const generated = this.taskPlanProvider.generate(goal);
    const resolved = this.taskPlanService.parse(
      JSON.stringify(generated, null, 2),
      "llm",
      "llm://curator-fallback",
    );
    this.taskPlanService.writeCanonicalPlan(resolved);
    return resolved;
  }

  private async waitForTasks(taskIds: string[], timeoutSeconds: number, label: string): Promise<boolean> {
    const startedAt = Date.now();
    let waitingForApprovalLogged = false;

    while (true) {
      await this.launchEligibleTasks(taskIds);
      this.statusManager.refresh();

      if (this.areTasksTerminal(taskIds)) {
        return true;
      }

      const tasks = taskIds
        .map(taskId => this.taskManager.readTask(taskId))
        .filter((task): task is ParsedTask => task !== null);

      const waitingForApproval = tasks.filter(task => task.status === "plan_ready");
      if (waitingForApproval.length > 0 && !waitingForApprovalLogged) {
        waitingForApprovalLogged = true;
        this.logger.logEntry(
          "Maestro",
          `Waiting for manual plan approval in ${label}: ${waitingForApproval.map(task => task.id).join(", ")}`,
          { level: "warn" },
        );
      }

      if ((Date.now() - startedAt) / 1000 > timeoutSeconds) {
        for (const taskId of taskIds) {
          const worker = this.delegationEngine.getActiveWorker(taskId);
          if (!worker) continue;
          this.runtime.interrupt(worker.runtimeHandle, `${label} timeout exceeded`);
        }
        return false;
      }

      await sleep(2000);
    }
  }

  private async launchEligibleTasks(taskIds: string[]): Promise<void> {
    for (const taskId of taskIds) {
      const task = this.taskManager.readTask(taskId);
      if (!task) continue;
      if (isTerminal(task.status)) continue;
      if (task.status === "plan_ready") continue;
      if (this.delegationEngine.getActiveWorker(taskId)) continue;
      if (!this.runtime.hasCapacity()) return;

      try {
        await this.delegationEngine.delegate({
          agentName: task.assignedTo,
          taskId: task.id,
          taskTitle: task.title,
          taskDescription: task.description,
          taskType: task.taskType,
          acceptanceCriteria: task.acceptanceCriteria,
          phase: task.phase,
          wave: task.wave,
          dependencies: task.dependencies,
          planFirst: task.planFirst,
          timeBudget: task.timeBudget,
          parentTaskId: task.parentTask,
          delegationDepth: Math.max(0, this.agentResolver.getAgentHierarchyLevel(task.assignedTo) - 1),
        });
      } catch (error: any) {
        if (String(error?.message ?? "").includes("Spawn budget exhausted")) {
          return;
        }
        throw error;
      }
    }
  }

  private async runReconciliationLoop(wave: number, commands: string[]): Promise<boolean> {
    const fixAgent = this.pickReconciliationAgent();

    for (let attempt = 1; attempt <= this.config.limits.max_reconcile_retries; attempt++) {
      let failingCommand: string | null = null;
      let failureOutput = "";

      for (const command of commands) {
        const result = this.reconcileEngine.run(command);
        if (!result.passed) {
          failingCommand = command;
          failureOutput = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n\n");
          break;
        }
      }

      if (!failingCommand) {
        return true;
      }

      const fixTaskId = `task-reconcile-${wave}-${attempt}`;
      this.taskManager.upsertTaskDefinition({
        taskId: fixTaskId,
        title: `Fix reconciliation failure after wave ${wave}`,
        description: [
          `Wave ${wave} reconciliation failed on command: \`${failingCommand}\``,
          "",
          "Resolve the failure and update the handoff report when done.",
          "",
          "## Failing Output",
          "",
          "```",
          failureOutput.slice(0, 4000),
          "```",
        ].join("\n"),
        assignedTo: fixAgent,
        taskType: "implementation",
        acceptanceCriteria: [`The command \`${failingCommand}\` passes successfully.`],
        wave,
        dependencies: [],
        parentTask: null,
        planFirst: false,
        timeBudget: this.config.limits.task_timeout_seconds,
      });

      this.logger.logEntry(
        "Reconcile",
        `Created ${fixTaskId} assigned to ${fixAgent} after '${failingCommand}' failed`,
        { level: "warn", taskId: fixTaskId },
      );

      const fixed = await this.waitForTasks([fixTaskId], this.config.limits.wave_timeout_seconds, `reconciliation attempt ${attempt}`);
      if (!fixed) {
        return false;
      }
    }

    return false;
  }

  private pickReconciliationAgent(): string {
    return this.config.teams.find(team => team.name === "Engineering")?.lead.name
      ?? this.config.teams[0]?.lead.name
      ?? this.config.maestro.name;
  }

  private areTasksTerminal(taskIds: string[]): boolean {
    return taskIds.every(taskId => {
      const task = this.taskManager.readTask(taskId);
      return !!task && isTerminal(task.status);
    });
  }
}

function isTerminal(status: ParsedTask["status"]): boolean {
  return status === "complete" || status === "failed";
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
