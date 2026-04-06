/**
 * Agent Maestro - Main entry point.
 * Reference: arc42 Section 6.1 (Full Delegation Flow), 6.6 (Wave-Based Execution)
 *
 * Orchestration loop:
 *  1. Read goal
 *  2. Initialize system (config, agents, memory, workspace)
 *  3. Start web server
 *  4. For each wave: delegate tasks, monitor, reconcile
 *  5. Complete session
 */

import { join } from "node:path";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { v4 as uuid } from "uuid";
import { loadConfig, AgentResolver } from "./config.js";
import { MemorySubsystem } from "./memory/index.js";
import { PromptAssembler } from "./prompt-assembler.js";
import { TaskManager } from "./task-manager.js";
import { Logger } from "./logger.js";
import { StatusManager } from "./status-manager.js";
import { DelegationEngine } from "./delegation-engine.js";
import { MonitorEngine } from "./monitor-engine.js";
import { ReconcileEngine } from "./reconcile-engine.js";
import { OrchestrationEngine } from "./orchestration-engine.js";
import { TaskPlanService } from "./task-plan.js";
import { TaskPlanProvider } from "./task-plan-provider.js";
import { createAgentRuntime, hasExistingSessionState } from "./startup.js";
import { createWebServer } from "../web/server/index.js";
import { formatTimestamp } from "./utils.js";
import type {
  SystemConfig,
  SessionState,
  ActiveWorker,
  ParsedTask,
  DailyProtocolEntry,
} from "./types.js";
import type { AgentRuntime } from "./runtime/agent-runtime.js";

// ── CLI Args ─────────────────────────────────────────────────────────

const isResume = process.argv.includes("--resume");
const rootDir = process.env["MAESTRO_ROOT"] || process.cwd();
const runtimeMode = (process.env["MAESTRO_RUNTIME"] || "auto").toLowerCase();
const exitOnIdle = /^(?:1|true|yes)$/i.test(process.env["MAESTRO_EXIT_ON_IDLE"] ?? "");
const webHost = process.env["MAESTRO_HOST"]?.trim() || "127.0.0.1";
const webPort = parsePort(process.env["MAESTRO_PORT"]) ?? 3000;

// ── Bootstrap ────────────────────────────────────────────────────────

async function main() {
  console.log("=== Agent Maestro v3.0 ===");
  console.log(`Root: ${rootDir}`);
  console.log(`Mode: ${isResume ? "resume" : "new session"}`);
  console.log(`Runtime: ${runtimeMode}`);

  // Load config
  let config: SystemConfig;
  try {
    config = loadConfig(rootDir);
    console.log(`Config loaded: ${config.teams.length} teams, ${config.project_name}`);
  } catch (err: any) {
    console.error(`Config error: ${err.message}`);
    process.exit(1);
  }

  // Initialize paths
  const workspaceDir = join(rootDir, config.paths.workspace);
  const memoryDir = join(rootDir, config.paths.memory);
  const logsDir = join(rootDir, config.paths.logs);

  for (const dir of [
    workspaceDir,
    join(workspaceDir, "tasks"),
    join(workspaceDir, "runtime-policies"),
    join(workspaceDir, "runtime-sessions"),
    join(workspaceDir, "runtime-turns"),
    memoryDir,
    logsDir,
  ]) {
    mkdirSync(dir, { recursive: true });
  }

  // Read goal
  const goalPath = join(workspaceDir, "goal.md");
  if (!existsSync(goalPath)) {
    console.error("No goal.md found. Run: ./run.sh \"Your goal\"");
    process.exit(1);
  }
  const goal = readFileSync(goalPath, "utf-8");
  console.log(`Goal: ${goal.split("\n").slice(2, 3).join("").trim()}`);

  // Initialize components
  const agentResolver = new AgentResolver(rootDir, config);
  const memory = new MemorySubsystem(rootDir, memoryDir, config.memory);
  memory.initialize();

  if (!isResume && hasExistingSessionState(workspaceDir)) {
    console.error("Existing workspace session state detected. Start fresh via ./run.sh or use --resume.");
    process.exit(1);
  }

  const logger = new Logger(workspaceDir);
  logger.initialize();

  const taskManager = new TaskManager(workspaceDir);
  const statusManager = new StatusManager(workspaceDir, taskManager);

  const promptAssembler = new PromptAssembler(rootDir, config, memory);
  const runtime = createAgentRuntime(runtimeMode, config);
  runtime.ensureReady();

  const delegationEngine = new DelegationEngine(
    rootDir, config, agentResolver, promptAssembler, runtime,
    taskManager, logger, memory,
  );

  const monitorEngine = new MonitorEngine(
    runtime, taskManager, logger, config.limits.stall_timeout_seconds,
  );

  const reconcileEngine = new ReconcileEngine(rootDir, config, taskManager, logger);
  const taskPlanService = new TaskPlanService(rootDir, config, agentResolver);
  const taskPlanProvider = new TaskPlanProvider(rootDir, config, agentResolver, logger);

  // Session state
  const session: SessionState = {
    sessionId: uuid(),
    tmuxSessionName: config.tmux_session,
    goal,
    startedAt: formatTimestamp(),
    status: "active",
    currentWave: 0,
    activeWorkers: delegationEngine.getActiveWorkers(),
  };

  // Start web server
  const webServer = createWebServer({
    rootDir,
    config,
    taskManager,
    agentResolver,
    logger,
    getSession: () => session,
  });
  await webServer.start(webPort, webHost);

  logger.logEntry("Maestro", "Session started", { level: "info" });
  logger.logEntry("Maestro", `Goal: ${goal.split("\n").slice(2, 3).join("").trim()}`, { level: "info" });
  statusManager.initialize();

  // Ensure agent memory directories
  for (const agent of agentResolver.getAllAgents()) {
    memory.expertise.ensureAgentMemory(agent.frontmatter.name);
  }

  // ── Session Resume ───────────────────────────────────────────────

  if (isResume) {
    logger.logEntry("Maestro", "Resuming session from workspace state", { level: "info" });
    const tasks = taskManager.getAllTasks();
    const maxWave = Math.max(0, ...tasks.map(t => t.wave));
    const completedWaves = new Set<number>();
    for (let w = 1; w <= maxWave; w++) {
      if (monitorEngine.isWaveComplete(w)) completedWaves.add(w);
    }
    session.currentWave = completedWaves.size;
    console.log(`Resumed: ${tasks.length} tasks, ${completedWaves.size} waves completed`);
    statusManager.refresh();
  }

  // ── Orchestration Loop ───────────────────────────────────────────

  // Write a shared context README if missing
  const sharedContextDir = join(rootDir, config.paths.shared_context);
  mkdirSync(sharedContextDir, { recursive: true });
  const readmePath = join(sharedContextDir, "README.md");
  if (!existsSync(readmePath)) {
    writeFileSync(readmePath, [
      `# ${config.project_name}`,
      "",
      "This is the shared context injected into every agent's system prompt.",
      "",
      "## Project Structure",
      "- `workspace/` - Coordination files (goal, plan, status, log, tasks)",
      "- `agents/` - Agent definitions (Maestro, Leads, Workers)",
      "- `memory/` - 4-level memory system",
      "- `skills/` - Reusable skill documents",
      "",
    ].join("\n"), "utf-8");
  }

  const orchestrationEngine = new OrchestrationEngine({
    rootDir,
    config,
    session,
    agentResolver,
    taskPlanService,
    taskPlanProvider,
    taskManager,
    delegationEngine,
    monitorEngine,
    reconcileEngine,
    statusManager,
    logger,
    memory,
    runtime,
  });

  // Monitoring loop
  let monitorInterval: NodeJS.Timeout;
  monitorInterval = setInterval(() => {
    const workers = delegationEngine.getActiveWorkers();
    if (workers.size === 0) return;

    consumeRuntimeControlSignals(
      workers,
      taskManager,
      runtime,
      logger,
      memory,
      agentResolver,
      promptAssembler,
    );
    const results = monitorEngine.monitorAll(workers);

    for (const result of results) {
      const task = taskManager.readTask(result.taskId);
      const worker = delegationEngine.getActiveWorker(result.taskId);

      if (task && worker && result.hasNewOutput && task.status === "stalled") {
        taskManager.updateStatus(result.taskId, "in_progress");
        appendSessionEvent(memory, result.taskId, "Activity resumed after stalled state.");
        logger.logEntry("Monitor", `Activity resumed for ${result.taskId}; clearing stalled state`, {
          taskId: result.taskId,
          correlationId: task.correlationId,
        });
      }

      if (task && worker && task.status !== "complete" && task.status !== "failed") {
        const elapsedSeconds = (Date.now() - worker.startedAt.getTime()) / 1000;
        if (elapsedSeconds > task.timeBudget) {
          runtime.interrupt(worker.runtimeHandle, `Task timeout exceeded (${task.timeBudget}s)`);
          taskManager.updateStatus(result.taskId, "failed");
          appendSessionEvent(memory, result.taskId, `Task timed out after ${Math.round(elapsedSeconds)}s.`);
          promoteTaskMemory(memory, task, worker.agentName, "failed");
          logger.logEntry("Monitor", `Task timeout for ${result.taskId} after ${Math.round(elapsedSeconds)}s`, {
            level: "error",
            taskId: result.taskId,
            correlationId: task.correlationId,
          });
          checkpointMemory(memory, `${result.taskId} failed`);
          delegationEngine.completeWorker(result.taskId);
          monitorEngine.clearCache(result.taskId);
          continue;
        }
      }

      if (task && worker && result.isStalled && task.status === "in_progress") {
        taskManager.updateStatus(result.taskId, "stalled");
        appendSessionEvent(memory, result.taskId, "No new output detected; worker moved to stalled and received a nudge.");
        runtime.resume(worker.runtimeHandle, {
          phase: task.phase,
          message: [
            `No new output was detected for ${config.limits.stall_timeout_seconds}s.`,
            "Re-read the task file before making further edits because Maestro may have updated its status to stalled.",
            "Then provide a progress update or continue the task immediately.",
          ].join("\n"),
        });
        logger.logEntry("Monitor", `Sent stall nudge to ${result.taskId}`, {
          level: "warn",
          taskId: result.taskId,
          correlationId: task.correlationId,
        });
      }

      if (result.taskStatus === "complete") {
        const validation = taskManager.validateHandoff(result.taskId);

        if (validation.status === "invalid") {
          taskManager.updateStatus(result.taskId, "in_progress");
          appendSessionEvent(memory, result.taskId, `Handoff validation failed: ${validation.issues.join("; ")}`);
          logger.logEntry(
            "Validation",
            `Rejected handoff for ${result.taskId}: ${validation.issues.join("; ")}`,
            {
              level: "warn",
              taskId: result.taskId,
              correlationId: worker?.correlationId ?? task?.correlationId ?? null,
            }
          );

          if (worker) {
            runtime.resume(worker.runtimeHandle, {
              phase: "phase_2_execute",
              message: [
                "Your handoff report was rejected by the lead-level validation gate.",
                "Re-read the task file before editing it again.",
                "Update the task file with these exact sections before setting status to complete:",
                "## Handoff Report",
                "### Changes Made",
                "### Patterns Followed",
                "### Unresolved Concerns",
                "### Suggested Follow-ups",
                ...validation.issues.map(issue => `- ${issue}`),
                "Revise the implementation or handoff report, then set the task status to complete again.",
              ].join("\n"),
            });
          }
          continue;
        }
      }

      // Handle completed workers
      if (result.taskStatus === "complete" || result.taskStatus === "failed") {
        if (task && worker) {
          appendSessionEvent(memory, result.taskId, `Task reached terminal status: ${result.taskStatus}.`);
          promoteTaskMemory(memory, task, worker.agentName, result.taskStatus);
        }
        delegationEngine.completeWorker(result.taskId);
        monitorEngine.clearCache(result.taskId);

        // Git checkpoint on completion
        checkpointMemory(memory, `${result.taskId} ${result.taskStatus}`);
      }

      // Handle dead runtimes
      if (
        !result.runtimeAlive &&
        result.taskStatus !== "complete" &&
        result.taskStatus !== "failed" &&
        result.taskStatus !== "plan_ready" &&
        result.taskStatus !== "plan_approved" &&
        result.taskStatus !== "plan_revision_needed"
      ) {
        logger.logEntry("Monitor", `Agent crashed: ${result.agentName} (${result.taskId})`, {
          level: "error",
          taskId: result.taskId,
          correlationId: task?.correlationId ?? null,
        });
        if (task && worker) {
          appendSessionEvent(memory, result.taskId, "Runtime disappeared unexpectedly; task marked failed.");
          promoteTaskMemory(memory, task, worker.agentName, "failed");
        }
        taskManager.updateStatus(result.taskId, "failed");
        checkpointMemory(memory, `${result.taskId} failed`);
        delegationEngine.completeWorker(result.taskId);
      }
    }

    const escalationCandidates = monitorEngine.getEscalationCandidates(
      workers,
      config.limits.escalate_after_seconds,
    );

    for (const worker of escalationCandidates) {
      const task = taskManager.readTask(worker.taskId);
      if (!task || task.status !== "stalled") continue;

      runtime.interrupt(
        worker.runtimeHandle,
        `Escalation timeout exceeded (${config.limits.escalate_after_seconds}s without output)`,
      );
      taskManager.updateStatus(worker.taskId, "failed");
      appendSessionEvent(memory, worker.taskId, "Stall escalation threshold exceeded; task marked failed.");
      promoteTaskMemory(memory, task, worker.agentName, "failed");
      logger.logEntry("Monitor", `Escalated stalled task ${worker.taskId} to failure`, {
        level: "error",
        taskId: worker.taskId,
        correlationId: task.correlationId,
      });
      checkpointMemory(memory, `${worker.taskId} failed`);
      delegationEngine.completeWorker(worker.taskId);
      monitorEngine.clearCache(worker.taskId);
    }

    // Refresh status table
    statusManager.refresh();

    // Process delegation queue
    const queued = delegationEngine.processQueue();
    if (queued) {
      delegationEngine.delegate(queued).catch(err => {
        logger.logEntry("Maestro", `Queued delegation failed: ${err.message}`, { level: "error" });
      });
    }
  }, 5000);

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = async (exitCode: number = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\nShutting down...");
    clearInterval(monitorInterval);
    if (session.status === "active") {
      session.status = exitCode === 0 ? "completed" : "failed";
    }
    logger.logEntry("Maestro", "Session ended", { level: "info" });
    statusManager.refresh();

    // Final memory checkpoint
    try {
      memory.gitCheckpoint.checkpoint("session end");
    } catch {
      // Non-fatal
    }

    await webServer.stop();
    process.exit(exitCode);
  };

  process.on("SIGINT", () => { void shutdown(0); });
  process.on("SIGTERM", () => { void shutdown(0); });

  try {
    await orchestrationEngine.run(goal);
    logger.logEntry("Maestro", "All planned waves completed", { level: "info" });
    session.status = "completed";
  } catch (err: any) {
    logger.logEntry("Maestro", `Orchestration failed: ${err.message}`, { level: "error" });
    session.status = "failed";
  }

  const terminalMessage = session.status === "completed"
    ? "Session completed. Web UI remains available until you stop Maestro."
    : "Session failed. Web UI remains available for inspection until you stop Maestro.";
  logger.logEntry("Maestro", terminalMessage, {
    level: session.status === "completed" ? "info" : "error",
  });
  console.log(terminalMessage);

  if (exitOnIdle) {
    await shutdown(session.status === "completed" ? 0 : 1);
    return;
  }

  await new Promise<void>(() => {});
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});

function consumeRuntimeControlSignals(
  workers: Map<string, ActiveWorker>,
  taskManager: TaskManager,
  runtime: AgentRuntime,
  logger: Logger,
  memory: MemorySubsystem,
  agentResolver: AgentResolver,
  promptAssembler: PromptAssembler,
): void {
  for (const [taskId, worker] of workers) {
    const task = taskManager.readTask(taskId);
    if (!task) continue;

    if (task.status === "plan_approved") {
      refreshRuntimePrompt(task, worker.agentName, agentResolver, promptAssembler);
      appendSessionEvent(memory, taskId, "Plan approved by lead; resuming execution phase.");
      runtime.resume(worker.runtimeHandle, {
        phase: "phase_2_execute",
        message: "The proposed approach is approved. Proceed to implementation and complete the task.",
      });
      taskManager.updateStatus(taskId, "in_progress");
      logger.logEntry("Monitor", `Consumed plan_approved for ${taskId}; resumed ${worker.agentName} in phase_2_execute`, {
        taskId,
        correlationId: task.correlationId,
      });
      continue;
    }

    if (task.status === "plan_revision_needed") {
      refreshRuntimePrompt(task, worker.agentName, agentResolver, promptAssembler);
      appendSessionEvent(memory, taskId, `Plan revision requested: ${task.revisionFeedback ?? "No explicit feedback provided."}`);
      runtime.resume(worker.runtimeHandle, {
        phase: "phase_1_plan",
        message: [
          "Revise the proposed approach based on lead feedback.",
          task.revisionFeedback ?? "No explicit feedback provided.",
          "Do not implement yet. Update the Proposed Approach section and set status to plan_ready again.",
        ].join("\n"),
      });
      taskManager.updateStatus(taskId, "in_progress");
      logger.logEntry("Monitor", `Consumed plan_revision_needed for ${taskId}; resumed ${worker.agentName} in phase_1_plan`, {
        level: "warn",
        taskId,
        correlationId: task.correlationId,
      });
    }
  }
}

function refreshRuntimePrompt(
  task: ParsedTask,
  agentName: string,
  agentResolver: AgentResolver,
  promptAssembler: PromptAssembler,
): void {
  const agent = agentResolver.findAgentByName(agentName);
  if (!agent) return;

  promptAssembler.assemble(agent, {
    agentName,
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
    delegationDepth: Math.max(0, agentResolver.getAgentHierarchyLevel(agentName) - 1),
  });
}

function appendSessionEvent(memory: MemorySubsystem, taskId: string, content: string): void {
  memory.sessionDAG.append(taskId, {
    role: "system",
    content,
  });
}

function promoteTaskMemory(
  memory: MemorySubsystem,
  task: ParsedTask,
  agentName: string,
  outcome: "complete" | "failed",
): void {
  const entries = buildDailyProtocolEntries(task, agentName, outcome);
  if (entries.length === 0) return;
  memory.dailyProtocol.flush(entries);
}

function buildDailyProtocolEntries(
  task: ParsedTask,
  agentName: string,
  outcome: "complete" | "failed",
): DailyProtocolEntry[] {
  const time = new Date().toISOString().slice(11, 16);
  const entries: DailyProtocolEntry[] = [];

  if (outcome === "failed") {
    entries.push({
      time,
      agent: agentName,
      confidence: 0.9,
      content: `Task ${task.id} failed while "${task.title}". Review workspace/task state and runtime logs for recovery context.`,
      sourceTask: task.id,
      category: "error_pattern",
    });
  }

  if (!task.handoffReport) {
    return entries;
  }

  entries.push({
    time,
    agent: agentName,
    confidence: 0.85,
    content: `${task.id} completed: ${task.handoffReport.changesMade}`,
    sourceTask: task.id,
    category: "finding",
  });

  entries.push({
    time,
    agent: agentName,
    confidence: 0.8,
    content: `${task.id} patterns followed: ${task.handoffReport.patternsFollowed}`,
    sourceTask: task.id,
    category: "decision",
  });

  if (!isExplicitNone(task.handoffReport.unresolvedConcerns)) {
    entries.push({
      time,
      agent: agentName,
      confidence: 0.75,
      content: `${task.id} unresolved concerns: ${task.handoffReport.unresolvedConcerns}`,
      sourceTask: task.id,
      category: "error_pattern",
    });
  }

  if (!isExplicitNone(task.handoffReport.suggestedFollowups)) {
    entries.push({
      time,
      agent: agentName,
      confidence: 0.75,
      content: `${task.id} follow-ups: ${task.handoffReport.suggestedFollowups}`,
      sourceTask: task.id,
      category: "decision",
    });
  }

  return entries;
}

function parsePort(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isInteger(value) && value > 0 && value <= 65535 ? value : null;
}

function checkpointMemory(memory: MemorySubsystem, message: string): void {
  try {
    memory.gitCheckpoint.checkpoint(message);
  } catch {
    // Git might not be initialized -- non-fatal
  }
}

function isExplicitNone(value: string): boolean {
  return /^(?:none|none noted|no follow-?ups|no unresolved concerns|n\/a)$/i.test(value.trim());
}
