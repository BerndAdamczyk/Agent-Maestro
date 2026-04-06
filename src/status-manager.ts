/**
 * Status Manager - maintains workspace/status.md.
 * Reference: arc42 Section 8.1 (File-based Coordination), 8.11 (Conflict Resolution)
 *
 * Maestro is the sole writer of the status table.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ParsedTask } from "./types.js";
import type { TaskManager } from "./task-manager.js";
import { atomicWrite, formatTimestamp } from "./utils.js";

export class StatusManager {
  private statusPath: string;
  private taskManager: TaskManager;

  constructor(workspaceDir: string, taskManager: TaskManager) {
    this.statusPath = join(workspaceDir, "status.md");
    this.taskManager = taskManager;
  }

  initialize(): void {
    this.refresh();
  }

  /**
   * Rebuild status.md from current task files.
   * Single-writer: only the Maestro calls this.
   */
  refresh(): void {
    const tasks = this.taskManager.getAllTasks();

    const lines: string[] = [
      "# Task Status",
      "",
      `_Last updated: ${formatTimestamp()}_`,
      "",
      "| Task | Title | Assigned To | Wave | Status | Phase |",
      "|------|-------|-------------|------|--------|-------|",
    ];

    for (const task of tasks) {
      lines.push(
        `| ${task.id} | ${task.title} | ${task.assignedTo} | ${task.wave} | ${task.status} | ${task.phase} |`
      );
    }

    lines.push("");
    atomicWrite(this.statusPath, lines.join("\n"));
  }

  /**
   * Get a summary for injection into agent prompts.
   */
  getSummary(): string {
    if (!existsSync(this.statusPath)) return "";
    return readFileSync(this.statusPath, "utf-8");
  }
}
