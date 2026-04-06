/**
 * Task Manager - CRUD on workspace/tasks/.
 * Reference: arc42 Section 5.2.1 (TaskManager), 8.1 (File-based Coordination)
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type {
  ParsedTask,
  TaskStatus,
  TaskPhase,
  HandoffReport,
  HandoffValidation,
} from "./types.js";
import { validateHandoffReport } from "./handoff-validator.js";

const TASK_ID_RE = /^task-(\d+)\.md$/;

export class TaskManager {
  private tasksDir: string;
  private nextId: number;

  constructor(workspaceDir: string) {
    this.tasksDir = join(workspaceDir, "tasks");
    mkdirSync(this.tasksDir, { recursive: true });
    this.nextId = this.findNextId();
  }

  private findNextId(): number {
    if (!existsSync(this.tasksDir)) return 1;
    const files = readdirSync(this.tasksDir);
    let max = 0;
    for (const f of files) {
      const m = f.match(TASK_ID_RE);
      if (m) max = Math.max(max, parseInt(m[1]!, 10));
    }
    return max + 1;
  }

  private taskFile(taskId: string): string {
    return join(this.tasksDir, `${taskId}.md`);
  }

  getTaskFilePath(taskId: string): string {
    return this.taskFile(taskId);
  }

  createTask(params: {
    title: string;
    description: string;
    assignedTo: string;
    wave: number;
    dependencies?: string[];
    parentTask?: string | null;
    planFirst?: boolean;
    timeBudget?: number;
  }): ParsedTask {
    const id = `task-${String(this.nextId++).padStart(3, "0")}`;
    const now = new Date().toISOString();

    const task: ParsedTask = {
      id,
      correlationId: randomUUID(),
      title: params.title,
      description: params.description,
      assignedTo: params.assignedTo,
      status: "pending",
      phase: params.planFirst ? "phase_1_plan" : "none",
      wave: params.wave,
      dependencies: params.dependencies ?? [],
      parentTask: params.parentTask ?? null,
      planFirst: params.planFirst ?? false,
      timeBudget: params.timeBudget ?? 600,
      createdAt: now,
      updatedAt: now,
      handoffReport: null,
      handoffValidation: null,
      proposedApproach: null,
      revisionFeedback: null,
    };

    this.writeTask(task);
    return task;
  }

  readTask(taskId: string): ParsedTask | null {
    const filePath = this.taskFile(taskId);
    if (!existsSync(filePath)) return null;
    return this.parseTaskFile(readFileSync(filePath, "utf-8"), taskId);
  }

  writeTask(task: ParsedTask): void {
    const content = this.serializeTask(task);
    writeFileSync(this.taskFile(task.id), content, "utf-8");
  }

  updateStatus(taskId: string, status: TaskStatus): void {
    const task = this.readTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    task.status = status;
    task.updatedAt = new Date().toISOString();

    // Phase transitions
    if (status === "plan_approved" && task.phase === "phase_1_plan") {
      task.phase = "phase_2_execute";
    }

    this.writeTask(task);
  }

  setHandoffReport(taskId: string, report: HandoffReport): void {
    const task = this.readTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    task.handoffReport = report;
    task.handoffValidation = null;
    task.updatedAt = new Date().toISOString();
    this.writeTask(task);
  }

  validateHandoff(taskId: string): HandoffValidation {
    const task = this.readTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    const validation = validateHandoffReport(task.handoffReport);
    task.handoffValidation = validation;
    task.updatedAt = new Date().toISOString();
    this.writeTask(task);
    return validation;
  }

  setProposedApproach(taskId: string, approach: string): void {
    const task = this.readTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    task.proposedApproach = approach;
    task.updatedAt = new Date().toISOString();
    this.writeTask(task);
  }

  setRevisionFeedback(taskId: string, feedback: string): void {
    const task = this.readTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    task.revisionFeedback = feedback;
    task.updatedAt = new Date().toISOString();
    this.writeTask(task);
  }

  getAllTasks(): ParsedTask[] {
    if (!existsSync(this.tasksDir)) return [];
    const files = readdirSync(this.tasksDir).filter(f => TASK_ID_RE.test(f)).sort();
    return files.map(f => {
      const id = f.replace(".md", "");
      return this.readTask(id)!;
    }).filter(Boolean);
  }

  getTasksByWave(wave: number): ParsedTask[] {
    return this.getAllTasks().filter(t => t.wave === wave);
  }

  getTasksByStatus(status: TaskStatus): ParsedTask[] {
    return this.getAllTasks().filter(t => t.status === status);
  }

  // ── Serialization ────────────────────────────────────────────────

  private serializeTask(task: ParsedTask): string {
    const lines: string[] = [
      `# ${task.id}: ${task.title}`,
      "",
      `**Status:** ${task.status}`,
      `**Correlation ID:** ${task.correlationId}`,
      `**Assigned To:** ${task.assignedTo}`,
      `**Wave:** ${task.wave}`,
      `**Phase:** ${task.phase}`,
      `**Plan First:** ${task.planFirst}`,
      `**Time Budget:** ${task.timeBudget}s`,
      `**Dependencies:** ${task.dependencies.length > 0 ? task.dependencies.join(", ") : "none"}`,
      `**Parent Task:** ${task.parentTask ?? "none"}`,
      `**Created:** ${task.createdAt}`,
      `**Updated:** ${task.updatedAt}`,
      "",
      "## Description",
      "",
      task.description,
      "",
    ];

    if (task.proposedApproach) {
      lines.push("## Proposed Approach", "", task.proposedApproach, "");
    }

    if (task.revisionFeedback) {
      lines.push("## Revision Feedback", "", task.revisionFeedback, "");
    }

    if (task.handoffReport) {
      lines.push(
        "## Output",
        "",
        "### Changes Made",
        task.handoffReport.changesMade,
        "",
        "### Patterns Followed",
        task.handoffReport.patternsFollowed,
        "",
        "### Unresolved Concerns",
        task.handoffReport.unresolvedConcerns,
        "",
        "### Suggested Follow-ups",
        task.handoffReport.suggestedFollowups,
        "",
      );
    }

    if (task.handoffValidation) {
      lines.push(
        "## Validation",
        "",
        `**Handoff Validation:** ${task.handoffValidation.status}`,
        `**Validated At:** ${task.handoffValidation.validatedAt}`,
        "",
      );

      if (task.handoffValidation.issues.length > 0) {
        lines.push("### Validation Issues", "");
        for (const issue of task.handoffValidation.issues) {
          lines.push(`- ${issue}`);
        }
        lines.push("");
      }
    }

    return lines.join("\n");
  }

  parseTaskFile(content: string, taskId: string): ParsedTask {
    const get = (label: string): string => {
      const re = new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+)`, "m");
      const match = content.match(re);
      return match?.[1]?.trim() ?? "";
    };

    const getSection = (heading: string): string => {
      const re = new RegExp(`## ${heading}\\n\\n([\\s\\S]*?)(?=\\n## |$)`, "m");
      const match = content.match(re);
      return match?.[1]?.trim() ?? "";
    };

    const getSubSection = (heading: string): string => {
      const re = new RegExp(`### ${heading}\\n([\\s\\S]*?)(?=\\n### |\\n## |$)`, "m");
      const match = content.match(re);
      return match?.[1]?.trim() ?? "";
    };

    const titleMatch = content.match(/^# .+?:\s*(.+)$/m);
    const deps = get("Dependencies");

    let handoffReport: HandoffReport | null = null;
    if (content.includes("## Output")) {
      handoffReport = {
        changesMade: getSubSection("Changes Made"),
        patternsFollowed: getSubSection("Patterns Followed"),
        unresolvedConcerns: getSubSection("Unresolved Concerns"),
        suggestedFollowups: getSubSection("Suggested Follow-ups"),
      };
    }

    let handoffValidation: HandoffValidation | null = null;
    const validationStatus = get("Handoff Validation");
    if (validationStatus === "valid" || validationStatus === "invalid") {
      const validationIssues = getSubSection("Validation Issues")
        .split("\n")
        .map(line => line.replace(/^- /, "").trim())
        .filter(Boolean);

      handoffValidation = {
        status: validationStatus,
        validatedAt: get("Validated At") || new Date().toISOString(),
        issues: validationIssues,
      };
    }

    return {
      id: taskId,
      correlationId: get("Correlation ID") || taskId,
      title: titleMatch?.[1] ?? "",
      description: getSection("Description"),
      assignedTo: get("Assigned To"),
      status: (get("Status") || "pending") as TaskStatus,
      phase: (get("Phase") || "none") as TaskPhase,
      wave: parseInt(get("Wave") || "0", 10),
      dependencies: deps === "none" || !deps ? [] : deps.split(",").map(s => s.trim()),
      parentTask: get("Parent Task") === "none" ? null : get("Parent Task") || null,
      planFirst: get("Plan First") === "true",
      timeBudget: parseInt(get("Time Budget") || "600", 10),
      createdAt: get("Created") || new Date().toISOString(),
      updatedAt: get("Updated") || new Date().toISOString(),
      handoffReport,
      handoffValidation,
      proposedApproach: getSection("Proposed Approach") || null,
      revisionFeedback: getSection("Revision Feedback") || null,
    };
  }
}
