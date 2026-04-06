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
import { RuntimeManager } from "./runtime-manager.js";
import { TaskManager } from "./task-manager.js";
import { Logger } from "./logger.js";
import { StatusManager } from "./status-manager.js";
import { DelegationEngine } from "./delegation-engine.js";
import { MonitorEngine } from "./monitor-engine.js";
import { ReconcileEngine } from "./reconcile-engine.js";
import { createWebServer } from "../web/server/index.js";
import type { SystemConfig, SessionState, ActiveWorker } from "./types.js";
import type { AgentRuntime } from "./runtime/agent-runtime.js";
import { TmuxAgentRuntime } from "./runtime/tmux-agent-runtime.js";
import { DryRunAgentRuntime } from "./runtime/dry-run-runtime.js";

// ── CLI Args ─────────────────────────────────────────────────────────

const isResume = process.argv.includes("--resume");
const rootDir = process.env["MAESTRO_ROOT"] || process.cwd();
const runtimeMode = (process.env["MAESTRO_RUNTIME"] || "tmux").toLowerCase();

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

  for (const dir of [workspaceDir, join(workspaceDir, "tasks"), memoryDir, logsDir]) {
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

  const logger = new Logger(workspaceDir);
  logger.initialize();

  const taskManager = new TaskManager(workspaceDir);
  const statusManager = new StatusManager(workspaceDir, taskManager);

  const promptAssembler = new PromptAssembler(rootDir, config, memory);
  const runtime = createAgentRuntime(runtimeMode, config);

  const delegationEngine = new DelegationEngine(
    rootDir, config, agentResolver, promptAssembler, runtime,
    taskManager, logger, memory,
  );

  const monitorEngine = new MonitorEngine(
    runtime, taskManager, logger, config.limits.stall_timeout_seconds,
  );

  const reconcileEngine = new ReconcileEngine(rootDir, config, taskManager, logger);

  // Session state
  const session: SessionState = {
    sessionId: uuid(),
    tmuxSessionName: config.tmux_session,
    goal,
    startedAt: new Date().toISOString(),
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
  await webServer.start(3000, "127.0.0.1");

  logger.logEntry("Maestro", "Session started");
  logger.logEntry("Maestro", `Goal: ${goal.split("\n").slice(2, 3).join("").trim()}`);
  statusManager.initialize();

  // Ensure agent memory directories
  for (const agent of agentResolver.getAllAgents()) {
    memory.expertise.ensureAgentMemory(agent.frontmatter.name);
  }

  // ── Session Resume ───────────────────────────────────────────────

  if (isResume) {
    logger.logEntry("Maestro", "Resuming session from workspace state");
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

  console.log("\nMaestro is running. The orchestration loop is ready.");
  console.log("In production, this would connect to an LLM to decompose the goal.");
  console.log("For now, agents can be delegated via the Web UI or programmatically.\n");

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

  // Monitoring loop
  const monitorInterval = setInterval(() => {
    const workers = delegationEngine.getActiveWorkers();
    if (workers.size === 0) return;

    consumeRuntimeControlSignals(workers, taskManager, runtime, logger);
    const results = monitorEngine.monitorAll(workers);

    for (const result of results) {
      if (result.taskStatus === "complete") {
        const validation = taskManager.validateHandoff(result.taskId);

        if (validation.status === "invalid") {
          taskManager.updateStatus(result.taskId, "in_progress");
          logger.logEntry(
            "Validation",
            `Rejected handoff for ${result.taskId}: ${validation.issues.join("; ")}`
          );

          const worker = delegationEngine.getActiveWorker(result.taskId);
          if (worker) {
            runtime.resume(worker.runtimeHandle, {
              phase: "phase_2_execute",
              message: [
                "Your handoff report was rejected by the lead-level validation gate.",
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
        delegationEngine.completeWorker(result.taskId);
        monitorEngine.clearCache(result.taskId);

        // Git checkpoint on completion
        try {
          memory.gitCheckpoint.checkpoint(`${result.taskId} ${result.taskStatus}`);
        } catch {
          // Git might not be initialized -- non-fatal
        }
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
        logger.logEntry("Monitor", `Agent crashed: ${result.agentName} (${result.taskId})`);
        taskManager.updateStatus(result.taskId, "failed");
        delegationEngine.completeWorker(result.taskId);
      }
    }

    // Refresh status table
    statusManager.refresh();

    // Process delegation queue
    const queued = delegationEngine.processQueue();
    if (queued) {
      delegationEngine.delegate(queued).catch(err => {
        logger.logEntry("Maestro", `Queued delegation failed: ${err.message}`);
      });
    }
  }, 5000);

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\nShutting down...");
    clearInterval(monitorInterval);
    session.status = "completed";
    logger.logEntry("Maestro", "Session ended");
    statusManager.refresh();

    // Final memory checkpoint
    try {
      memory.gitCheckpoint.checkpoint("session end");
    } catch {
      // Non-fatal
    }

    await webServer.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});

function createAgentRuntime(mode: string, config: SystemConfig): AgentRuntime {
  switch (mode) {
    case "dry-run":
    case "dryrun":
      return new DryRunAgentRuntime(config.limits.max_panes);
    case "tmux":
      return new TmuxAgentRuntime(
        new RuntimeManager(config.tmux_session, config.limits.max_panes),
      );
    default:
      throw new Error(`Unsupported runtime '${mode}'. Expected 'tmux' or 'dry-run'.`);
  }
}

function consumeRuntimeControlSignals(
  workers: Map<string, ActiveWorker>,
  taskManager: TaskManager,
  runtime: AgentRuntime,
  logger: Logger,
): void {
  for (const [taskId, worker] of workers) {
    const task = taskManager.readTask(taskId);
    if (!task) continue;

    if (task.status === "plan_approved") {
      runtime.resume(worker.runtimeHandle, {
        phase: "phase_2_execute",
        message: "The proposed approach is approved. Proceed to implementation and complete the task.",
      });
      taskManager.updateStatus(taskId, "in_progress");
      logger.logEntry("Monitor", `Consumed plan_approved for ${taskId}; resumed ${worker.agentName} in phase_2_execute`);
      continue;
    }

    if (task.status === "plan_revision_needed") {
      runtime.resume(worker.runtimeHandle, {
        phase: "phase_1_plan",
        message: [
          "Revise the proposed approach based on lead feedback.",
          task.revisionFeedback ?? "No explicit feedback provided.",
          "Do not implement yet. Update the Proposed Approach section and set status to plan_ready again.",
        ].join("\n"),
      });
      taskManager.updateStatus(taskId, "in_progress");
      logger.logEntry("Monitor", `Consumed plan_revision_needed for ${taskId}; resumed ${worker.agentName} in phase_1_plan`);
    }
  }
}
