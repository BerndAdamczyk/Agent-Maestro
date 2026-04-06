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

      const waveTaskIds = waveTasks.map(task => task.id);

      if (this.areTasksComplete(waveTaskIds)) {
        this.session.currentWave = wave;
        continue;
      }

      const preexistingFailures = this.getFailedTaskIds(waveTaskIds);
      if (preexistingFailures.length > 0) {
        this.logger.logEntry(
          "Maestro",
          `Wave ${wave} has pre-existing failed tasks: ${preexistingFailures.join(", ")}; attempting remediation`,
          { level: "warn" },
        );
        const remediated = await this.runRemediationLoop(wave, preexistingFailures);
        if (!remediated) {
          this.session.status = "failed";
          throw new Error(`Wave ${wave} pre-existing failures could not be remediated: ${preexistingFailures.join(", ")}`);
        }
        // After successful remediation, check if the wave is now complete
        if (this.areTasksComplete(waveTaskIds)) {
          this.session.currentWave = wave;
          continue;
        }
      }

      this.session.currentWave = wave;
      this.logger.logEntry("Maestro", `Starting wave ${wave} with ${waveTasks.length} task(s)`, {
        level: "info",
      });

      const waitResult = await this.waitForTasks(
        waveTaskIds,
        this.config.limits.wave_timeout_seconds,
        `wave ${wave}`,
      );

      if (waitResult.status === "timeout") {
        this.session.status = "failed";
        throw new Error(`Wave ${wave} exceeded the configured timeout`);
      }

      if (waitResult.status === "failed") {
        const remediated = await this.runRemediationLoop(wave, waitResult.failedTaskIds);
        if (!remediated) {
          this.session.status = "failed";
          throw new Error(`Wave ${wave} failed tasks after exhausting remediation retries: ${waitResult.failedTaskIds.join(", ")}`);
        }
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

  private async waitForTasks(
    taskIds: string[],
    timeoutSeconds: number,
    label: string,
  ): Promise<{ status: "complete" | "failed" | "timeout"; failedTaskIds: string[] }> {
    const startedAt = Date.now();
    let waitingForApprovalLogged = false;

    while (true) {
      await this.launchEligibleTasks(taskIds);
      this.statusManager.refresh();

      const failedTaskIds = this.getFailedTaskIds(taskIds);
      if (failedTaskIds.length > 0) {
        this.interruptActiveTasks(taskIds, `${label} aborted after task failure`);
        return { status: "failed", failedTaskIds };
      }

      if (this.areTasksComplete(taskIds)) {
        return { status: "complete", failedTaskIds: [] };
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
        this.interruptActiveTasks(taskIds, `${label} timeout exceeded`);
        return { status: "timeout", failedTaskIds: [] };
      }

      await sleep(2000);
    }
  }

  private async launchEligibleTasks(taskIds: string[]): Promise<void> {
    for (const taskId of taskIds) {
      const task = this.taskManager.readTask(taskId);
      if (!task) continue;
      if (task.status === "complete" || task.status === "failed") continue;
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
      if (fixed.status !== "complete") {
        this.logger.logEntry(
          "Reconcile",
          `Reconciliation attempt ${attempt} ended with status '${fixed.status}'`,
          { level: "error", taskId: fixTaskId },
        );
        return false;
      }
    }

    return false;
  }

  /**
   * Remediation loop for failed wave tasks.
   *
   * Inspects failed tasks for actionable findings (handoff reports, revision
   * feedback, validation issues), creates fix tasks, waits for them, then
   * resets and re-runs the originally failed tasks. Retries up to
   * max_reconcile_retries times before giving up.
   */
  private async runRemediationLoop(
    wave: number,
    failedTaskIds: string[],
  ): Promise<boolean> {
    const maxAttempts = this.config.limits.max_reconcile_retries;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const findings = this.extractRemediationFindings(failedTaskIds);

      if (findings.length === 0) {
        this.logger.logEntry(
          "Remediation",
          `Wave ${wave} has ${failedTaskIds.length} failed task(s) but no actionable findings to remediate`,
          { level: "error" },
        );
        return false;
      }

      this.logger.logEntry(
        "Remediation",
        `Wave ${wave} attempt ${attempt}/${maxAttempts}: creating ${findings.length} fix task(s) for ${failedTaskIds.join(", ")}`,
        { level: "warn" },
      );

      // Create fix tasks
      const fixTaskIds: string[] = [];
      for (const finding of findings) {
        const fixTaskId = `task-fix-${wave}-${attempt}-${fixTaskIds.length + 1}`;
        this.taskManager.upsertTaskDefinition({
          taskId: fixTaskId,
          title: finding.title,
          description: finding.description,
          assignedTo: finding.assignTo,
          taskType: "implementation",
          acceptanceCriteria: finding.acceptanceCriteria,
          wave,
          dependencies: [],
          parentTask: null,
          planFirst: false,
          timeBudget: this.config.limits.task_timeout_seconds,
        });
        fixTaskIds.push(fixTaskId);

        this.logger.logEntry(
          "Remediation",
          `Created ${fixTaskId} assigned to ${finding.assignTo}: ${finding.title}`,
          { level: "info", taskId: fixTaskId },
        );
      }

      // Wait for fix tasks to complete
      const fixResult = await this.waitForTasks(
        fixTaskIds,
        this.config.limits.wave_timeout_seconds,
        `remediation wave ${wave} attempt ${attempt}`,
      );

      if (fixResult.status !== "complete") {
        this.logger.logEntry(
          "Remediation",
          `Fix tasks for wave ${wave} attempt ${attempt} ended with status '${fixResult.status}'`,
          { level: "error" },
        );
        if (attempt >= maxAttempts) return false;
        continue;
      }

      // Reset originally failed tasks so they can be re-run
      for (const taskId of failedTaskIds) {
        this.taskManager.updateStatus(taskId, "pending");
        this.logger.logEntry(
          "Remediation",
          `Reset ${taskId} to pending for re-evaluation after remediation`,
          { level: "info", taskId },
        );
      }

      // Re-run the originally failed tasks
      const retryResult = await this.waitForTasks(
        failedTaskIds,
        this.config.limits.wave_timeout_seconds,
        `wave ${wave} retry after remediation attempt ${attempt}`,
      );

      if (retryResult.status === "complete") {
        this.logger.logEntry(
          "Remediation",
          `Wave ${wave} passed after remediation attempt ${attempt}`,
          { level: "info" },
        );
        return true;
      }

      if (retryResult.status === "failed" && attempt < maxAttempts) {
        this.logger.logEntry(
          "Remediation",
          `Wave ${wave} still failing after attempt ${attempt}, will retry`,
          { level: "warn" },
        );
        // Update failedTaskIds for next iteration
        failedTaskIds = retryResult.failedTaskIds;
        continue;
      }

      this.logger.logEntry(
        "Remediation",
        `Wave ${wave} remediation attempt ${attempt} ended with '${retryResult.status}'`,
        { level: "error" },
      );
    }

    return false;
  }

  private extractRemediationFindings(
    failedTaskIds: string[],
  ): RemediationFinding[] {
    const findings: RemediationFinding[] = [];

    for (const taskId of failedTaskIds) {
      const task = this.taskManager.readTask(taskId);
      if (!task) continue;

      // Collect actionable text from all available sources
      const sources: string[] = [];

      if (task.handoffReport?.unresolvedConcerns && !isExplicitNone(task.handoffReport.unresolvedConcerns)) {
        sources.push(task.handoffReport.unresolvedConcerns);
      }

      if (task.handoffReport?.suggestedFollowups && !isExplicitNone(task.handoffReport.suggestedFollowups)) {
        sources.push(task.handoffReport.suggestedFollowups);
      }

      if (task.revisionFeedback) {
        sources.push(task.revisionFeedback);
      }

      if (task.handoffValidation?.issues && task.handoffValidation.issues.length > 0) {
        sources.push(task.handoffValidation.issues.join("\n"));
      }

      if (sources.length === 0) continue;

      const combinedFindings = sources.join("\n\n");
      const assignTo = this.pickRemediationAgent(task.assignedTo);

      findings.push({
        title: `Remediate findings from ${taskId}: ${task.title}`,
        description: [
          `Task ${taskId} ("${task.title}") failed with actionable findings that must be resolved before the wave can pass.`,
          "",
          "## Findings to Address",
          "",
          combinedFindings,
          "",
          "## Original Task Context",
          "",
          task.description,
          "",
          task.handoffReport?.changesMade
            ? `## Changes Already Made\n\n${task.handoffReport.changesMade}`
            : "",
        ].filter(Boolean).join("\n"),
        assignTo,
        acceptanceCriteria: [
          "All findings listed above are resolved in the codebase",
          `The validation that caused ${taskId} to fail now passes`,
        ],
      });
    }

    return findings;
  }

  /**
   * Pick the best agent for remediation. Prefer the original task's assigned
   * agent if it's a worker/lead (they have the context). Fall back to the
   * engineering lead or first available lead.
   */
  private pickRemediationAgent(originalAgent: string): string {
    const agent = this.agentResolver.findAgentByName(originalAgent);
    if (agent) {
      const role = this.agentResolver.getAgentRole(originalAgent);
      // Don't assign remediation to maestro itself
      if (role !== "maestro") return originalAgent;
    }
    return this.pickReconciliationAgent();
  }

  private pickReconciliationAgent(): string {
    return this.config.teams.find(team => team.name === "Engineering")?.lead.name
      ?? this.config.teams[0]?.lead.name
      ?? this.config.maestro.name;
  }

  private areTasksComplete(taskIds: string[]): boolean {
    return taskIds.every(taskId => {
      const task = this.taskManager.readTask(taskId);
      return !!task && task.status === "complete" && task.handoffValidation?.status === "valid";
    });
  }

  private getFailedTaskIds(taskIds: string[]): string[] {
    return taskIds.filter(taskId => this.taskManager.readTask(taskId)?.status === "failed");
  }

  private interruptActiveTasks(taskIds: string[], reason: string): void {
    for (const taskId of taskIds) {
      const worker = this.delegationEngine.getActiveWorker(taskId);
      if (!worker) continue;
      this.runtime.interrupt(worker.runtimeHandle, reason);
    }
  }
}

interface RemediationFinding {
  title: string;
  description: string;
  assignTo: string;
  acceptanceCriteria: string[];
}

function isExplicitNone(value: string): boolean {
  return /^(?:none|none noted|no follow-?ups|no unresolved concerns|n\/a)$/i.test(value.trim());
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
