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

import { statSync } from "node:fs";
import type { ActiveWorker, MonitorResult, TaskStatus } from "./types.js";
import type { TaskManager } from "./task-manager.js";
import type { Logger } from "./logger.js";
import type { AgentRuntime } from "./runtime/agent-runtime.js";

export class MonitorEngine {
  private runtime: AgentRuntime;
  private taskManager: TaskManager;
  private logger: Logger;
  private stallTimeout: number;           // seconds
  private lastOutputCache = new Map<string, string>();  // taskId -> last captured output
  private lastActivityMarkerCache = new Map<string, number>(); // taskId -> latest observed artifact mtime

  constructor(
    runtime: AgentRuntime,
    taskManager: TaskManager,
    logger: Logger,
    stallTimeout: number = 120,
  ) {
    this.runtime = runtime;
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
    result.runtimeAlive = this.runtime.isAlive(worker.runtimeHandle);

    if (!result.runtimeAlive) {
      const task = this.taskManager.readTask(worker.taskId);
      if (task) {
        result.taskStatus = task.status;
      }

      // Agent process is gone
      this.logger.logEntry("Monitor", `Agent ${worker.agentName} (${worker.taskId}) runtime dead`, {
        level: "warn",
        taskId: worker.taskId,
        correlationId: worker.correlationId,
      });
      return result;
    }

    // 2. Activity detection (new output since last poll)
    const currentOutput = this.runtime.getOutput(worker.runtimeHandle, 50);
    result.lastOutput = currentOutput;

    const previousOutput = this.lastOutputCache.get(worker.taskId) ?? "";
    this.lastOutputCache.set(worker.taskId, currentOutput);

    let hasNewActivity = currentOutput !== previousOutput;
    const activityMarker = this.getLatestActivityMarker(worker);
    const previousActivityMarker = this.lastActivityMarkerCache.get(worker.taskId);

    if (activityMarker !== null) {
      this.lastActivityMarkerCache.set(worker.taskId, activityMarker);
      if (previousActivityMarker !== undefined && activityMarker > previousActivityMarker) {
        hasNewActivity = true;
      }
    }

    result.hasNewOutput = hasNewActivity;

    if (result.hasNewOutput) {
      worker.lastOutputAt = new Date();
    }

    // 3. Task status file check
    let taskStatus: TaskStatus | null = null;
    const task = this.taskManager.readTask(worker.taskId);
    if (task) {
      taskStatus = task.status;
      result.taskStatus = task.status;

      if (task.status === "plan_ready" || task.status === "plan_approved" || task.status === "plan_revision_needed") {
        return result;
      }
    }

    // 4. Stall detection
    const secondsSinceOutput = (Date.now() - worker.lastOutputAt.getTime()) / 1000;
    result.isStalled = secondsSinceOutput > this.stallTimeout;

    if (result.isStalled && taskStatus !== "stalled") {
      this.logger.logEntry(
        "Monitor",
        `Agent ${worker.agentName} (${worker.taskId}) stalled: no output for ${Math.round(secondsSinceOutput)}s`,
        {
          level: "warn",
          taskId: worker.taskId,
          correlationId: worker.correlationId,
        }
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
    return tasks.length > 0 && tasks.every(t => t.status === "complete");
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
    this.lastActivityMarkerCache.delete(taskId);
  }

  private getLatestActivityMarker(worker: ActiveWorker): number | null {
    const runtimeResult = this.runtime.getResult?.(worker.runtimeHandle);
    if (!runtimeResult) return null;

    let latestMarker: number | null = null;

    for (const artifact of runtimeResult.artifacts) {
      if (artifact.type !== "pi-session" && artifact.type !== "task-file") {
        continue;
      }

      try {
        const stats = statSync(artifact.path);
        latestMarker = latestMarker === null
          ? stats.mtimeMs
          : Math.max(latestMarker, stats.mtimeMs);
      } catch {
        // Ignore missing/transient files; stdout-based monitoring still applies.
      }
    }

    return latestMarker;
  }
}
