/**
 * Reconciliation Engine.
 * Reference: arc42 Section 5.2.1 (ReconcileEngine), 6.3 (Reconciliation Loop)
 *
 * Runs validation commands, auto-creates fix-tasks on failure.
 * Loops until pass (max retries configurable).
 */

import { execSync } from "node:child_process";
import type { ReconcileResult, SystemConfig } from "./types.js";
import type { TaskManager } from "./task-manager.js";
import type { Logger } from "./logger.js";

export class ReconcileEngine {
  private config: SystemConfig;
  private taskManager: TaskManager;
  private logger: Logger;
  private rootDir: string;

  constructor(rootDir: string, config: SystemConfig, taskManager: TaskManager, logger: Logger) {
    this.rootDir = rootDir;
    this.config = config;
    this.taskManager = taskManager;
    this.logger = logger;
  }

  /**
   * Run a reconciliation command.
   */
  run(command: string): ReconcileResult {
    this.logger.logEntry("Reconcile", `Running: ${command}`);

    let stdout = "";
    let stderr = "";
    let exitCode = 0;

    try {
      stdout = execSync(command, {
        cwd: this.rootDir,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 60000,
      });
    } catch (err: any) {
      exitCode = err.status ?? 1;
      stdout = err.stdout ?? "";
      stderr = err.stderr ?? "";
    }

    const passed = exitCode === 0;

    this.logger.logEntry(
      "Reconcile",
      `${command}: ${passed ? "PASSED" : `FAILED (exit ${exitCode})`}`
    );

    return { command, exitCode, stdout, stderr, passed };
  }

  /**
   * Run reconciliation with auto fix-task creation on failure.
   * Returns true if all commands pass (possibly after fix-tasks).
   */
  reconcileWithRetry(
    commands: string[],
    wave: number,
    assignTo: string,
  ): { passed: boolean; fixTaskIds: string[]; attempts: number } {
    const fixTaskIds: string[] = [];
    const maxRetries = this.config.limits.max_reconcile_retries;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      let allPassed = true;

      for (const cmd of commands) {
        const result = this.run(cmd);

        if (!result.passed) {
          allPassed = false;

          // Create fix-task with error output
          const fixTask = this.taskManager.createTask({
            title: `Fix: ${cmd} failure (attempt ${attempt})`,
            description: [
              `Reconciliation command failed: \`${cmd}\``,
              "",
              "**Exit code:** " + result.exitCode,
              "",
              "**stdout:**",
              "```",
              result.stdout.slice(0, 2000),
              "```",
              "",
              "**stderr:**",
              "```",
              result.stderr.slice(0, 2000),
              "```",
              "",
              "Fix the issues and ensure the command passes.",
            ].join("\n"),
            assignedTo: assignTo,
            wave,
          });

          fixTaskIds.push(fixTask.id);

          this.logger.logEntry(
            "Reconcile",
            `Created fix-task ${fixTask.id} for '${cmd}' failure (attempt ${attempt}/${maxRetries})`
          );

          // Don't continue checking other commands -- fix first
          break;
        }
      }

      if (allPassed) {
        this.logger.logEntry("Reconcile", `All commands passed on attempt ${attempt}`);
        return { passed: true, fixTaskIds, attempts: attempt };
      }

      if (attempt < maxRetries) {
        this.logger.logEntry("Reconcile", `Attempt ${attempt}/${maxRetries} failed, will retry after fix-task`);
        // In a real execution, we'd wait for the fix-task to complete before retrying.
        // The orchestration loop handles this.
      }
    }

    this.logger.logEntry("Reconcile", `All ${maxRetries} attempts exhausted. Escalating to user.`);
    return { passed: false, fixTaskIds, attempts: maxRetries };
  }
}
