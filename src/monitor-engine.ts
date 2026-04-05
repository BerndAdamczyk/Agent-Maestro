/**
 * Monitoring Engine.
 * Reference: arc42 Section 5.2.1 (MonitorEngine), 8.7 (Lifecycle), 8.8 (Timeout/Stall)
 *
 * Captures output, reads task status, detects completion/stalls.
 * Status determination priority cascade:
 *  1. Runtime alive check
 *  2. Agent activity detection
 *  3. Task status file check
 *  4. Stall detection
 */

import type { ActiveWorker, MonitorResult, TaskStatus } from "./types.js";
import type { RuntimeManager } from "./runtime-manager.js";
import type { TaskManager } from "./task-manager.js";
import type { Logger } from "./logger.js";

export class MonitorEngine {
  private runtimeManager: RuntimeManager;
  private taskManager: TaskManager;
  private logger: Logger;
  private stallTimeout: number;           // seconds
  private lastOutputCache = new Map<string, string>();  // taskId -> last captured output

  constructor(
    runtimeManager: RuntimeManager,
    taskManager: TaskManager,
    logger: Logger,
    stallTimeout: number = 120,
  ) {
    this.runtimeManager = runtimeManager;
    this.taskManager = taskManager;
    this.logger = logger;
    this.stallTimeout = stallTimeout;
  }

  /**
   * Monitor a single active worker.
   * Returns structured result following the status priority cascade.
   */
  monitor(worker: ActiveWorker): MonitorResult {
    const result: MonitorResult = {
      taskId: worker.taskId,
      agentName: worker.agentName,
      runtimeAlive: false,
      hasNewOutput: false,
      taskStatus: null,
      isStalled: false,
      lastOutput: "",
    };

    // 1. Runtime alive check
    result.runtimeAlive = this.runtimeManager.isAlive(worker.runtimeId);

    if (!result.runtimeAlive) {
      // Agent process is gone
      this.logger.logEntry("Monitor", `Agent ${worker.agentName} (${worker.taskId}) runtime dead`);
      return result;
    }

    // 2. Activity detection (new output since last poll)
    const currentOutput = this.runtimeManager.capturePane(worker.runtimeId, 50);
    result.lastOutput = currentOutput;

    const previousOutput = this.lastOutputCache.get(worker.taskId) ?? "";
    result.hasNewOutput = currentOutput !== previousOutput;
    this.lastOutputCache.set(worker.taskId, currentOutput);

    if (result.hasNewOutput) {
      worker.lastOutputAt = new Date();
    }

    // 3. Task status file check
    const task = this.taskManager.readTask(worker.taskId);
    if (task) {
      result.taskStatus = task.status;
    }

    // 4. Stall detection
    const secondsSinceOutput = (Date.now() - worker.lastOutputAt.getTime()) / 1000;
    result.isStalled = secondsSinceOutput > this.stallTimeout;

    if (result.isStalled) {
      this.logger.logEntry(
        "Monitor",
        `Agent ${worker.agentName} (${worker.taskId}) stalled: no output for ${Math.round(secondsSinceOutput)}s`
      );
    }

    return result;
  }

  /**
   * Monitor all active workers.
   */
  monitorAll(workers: Map<string, ActiveWorker>): MonitorResult[] {
    const results: MonitorResult[] = [];
    for (const [taskId, worker] of workers) {
      results.push(this.monitor(worker));
    }
    return results;
  }

  /**
   * Check if all tasks in a wave are complete.
   */
  isWaveComplete(wave: number): boolean {
    const tasks = this.taskManager.getTasksByWave(wave);
    return tasks.every(t => t.status === "complete" || t.status === "failed");
  }

  /**
   * Get tasks that are complete and ready for the next phase.
   */
  getCompletedTasks(workers: Map<string, ActiveWorker>): string[] {
    const completed: string[] = [];
    for (const [taskId, worker] of workers) {
      const task = this.taskManager.readTask(taskId);
      if (task && (task.status === "complete" || task.status === "failed")) {
        completed.push(taskId);
      }
    }
    return completed;
  }

  /**
   * Detect workers needing escalation (stalled beyond escalation timeout).
   */
  getEscalationCandidates(workers: Map<string, ActiveWorker>, escalateAfterSeconds: number): ActiveWorker[] {
    const candidates: ActiveWorker[] = [];
    for (const [, worker] of workers) {
      const secondsSinceOutput = (Date.now() - worker.lastOutputAt.getTime()) / 1000;
      if (secondsSinceOutput > escalateAfterSeconds) {
        candidates.push(worker);
      }
    }
    return candidates;
  }

  clearCache(taskId: string): void {
    this.lastOutputCache.delete(taskId);
  }
}
