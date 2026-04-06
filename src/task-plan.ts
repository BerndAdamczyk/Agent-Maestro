/**
 * Task plan parsing, validation, and materialization.
 * Reference: arc42 Sections 6.1, 6.6, ADR-006
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYAML } from "yaml";
import type { AgentResolver } from "./config.js";
import type { TaskManager } from "./task-manager.js";
import {
  TaskPlanSchema,
  type ResolvedTaskPlan,
  type ResolvedTaskPlanTask,
  type SystemConfig,
  type TaskPlan,
} from "./types.js";
import { computeWaves } from "./wave-scheduler.js";
import { atomicWrite } from "./utils.js";

const FENCED_BLOCK_RE = /```(?:json|ya?ml)?\s*\n([\s\S]*?)```/gi;

export class TaskPlanService {
  private rootDir: string;
  private config: SystemConfig;
  private agentResolver: AgentResolver;

  constructor(rootDir: string, config: SystemConfig, agentResolver: AgentResolver) {
    this.rootDir = rootDir;
    this.config = config;
    this.agentResolver = agentResolver;
  }

  getPlanPath(): string {
    return join(this.rootDir, this.config.paths.workspace, "plan.md");
  }

  hasAuthoritativePlan(): boolean {
    return existsSync(this.getPlanPath());
  }

  loadAuthoritativePlan(): ResolvedTaskPlan {
    const path = this.getPlanPath();
    if (!existsSync(path)) {
      throw new Error(`No workspace plan found at ${path}`);
    }
    return this.parse(readFileSync(path, "utf-8"), "workspace", path);
  }

  parse(content: string, source: "workspace" | "llm", sourcePath: string): ResolvedTaskPlan {
    const parsed = parseTaskPlanDocument(content);
    return resolveTaskPlan(parsed, this.agentResolver, source, sourcePath);
  }

  writeCanonicalPlan(plan: ResolvedTaskPlan): void {
    const jsonPlan: TaskPlan = {
      schema_version: 1,
      goal: plan.goal,
      tasks: plan.tasks.map(task => ({
        id: task.id,
        title: task.title,
        description: task.description,
        assigned_to: task.assigned_to,
        task_type: task.task_type,
        dependencies: task.dependencies,
        parent_task: task.parent_task,
        plan_first: task.plan_first,
        time_budget: task.time_budget,
        acceptance_criteria: task.acceptance_criteria,
      })),
      validation_commands: plan.validation_commands,
    };

    const lines: string[] = [
      "# Task Plan",
      "",
      `_Source: ${plan.source} (${plan.sourcePath})_`,
      "",
      "```json",
      JSON.stringify(jsonPlan, null, 2),
      "```",
      "",
      "## Computed Waves",
      "",
      "| Wave | Task ID | Assigned To | Title |",
      "|------|---------|-------------|-------|",
    ];

    for (const task of sortResolvedTasks(plan.tasks)) {
      lines.push(`| ${task.wave} | ${task.id} | ${task.assigned_to} | ${escapeTableCell(task.title)} |`);
    }

    if (plan.validation_commands.length > 0) {
      lines.push("", "## Validation Commands", "");
      for (const command of plan.validation_commands) {
        lines.push(`- \`${command}\``);
      }
    }

    lines.push("");
    atomicWrite(this.getPlanPath(), lines.join("\n"));
  }

  materialize(plan: ResolvedTaskPlan, taskManager: TaskManager) {
    return sortResolvedTasks(plan.tasks).map(task =>
      taskManager.upsertTaskDefinition({
        taskId: task.id,
        title: task.title,
        description: task.description,
        assignedTo: task.assigned_to,
        taskType: task.task_type,
        acceptanceCriteria: task.acceptance_criteria,
        wave: task.wave,
        dependencies: task.dependencies,
        parentTask: task.parent_task,
        planFirst: task.plan_first,
        timeBudget: task.time_budget,
      })
    );
  }
}

export function parseTaskPlanDocument(content: string): TaskPlan {
  const candidates = [content, ...extractFenceBlocks(content)];
  const errors: string[] = [];

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (!trimmed) continue;

    for (const parser of [parseJsonCandidate, parseYamlCandidate]) {
      try {
        const parsed = parser(trimmed);
        return TaskPlanSchema.parse(parsed);
      } catch (error: any) {
        errors.push(error.message);
      }
    }
  }

  throw new Error(`Unable to parse TaskPlan document. Parsers tried: ${errors.slice(0, 6).join(" | ")}`);
}

export function resolveTaskPlan(
  plan: TaskPlan,
  agentResolver: AgentResolver,
  source: "workspace" | "llm",
  sourcePath: string,
): ResolvedTaskPlan {
  const ids = new Set<string>();

  for (const task of plan.tasks) {
    if (ids.has(task.id)) {
      throw new Error(`Duplicate task ID in plan: ${task.id}`);
    }
    ids.add(task.id);

    if (!agentResolver.findAgentByName(task.assigned_to)) {
      throw new Error(`Task ${task.id} is assigned to unknown agent '${task.assigned_to}'`);
    }
  }

  for (const task of plan.tasks) {
    for (const dependency of task.dependencies) {
      if (!ids.has(dependency)) {
        throw new Error(`Task ${task.id} depends on unknown task '${dependency}'`);
      }
    }

    if (task.parent_task && !ids.has(task.parent_task)) {
      throw new Error(`Task ${task.id} references unknown parent task '${task.parent_task}'`);
    }
  }

  const assignments = computeWaves(plan.tasks.map(task => ({
    id: task.id,
    dependencies: task.dependencies,
  })));
  const waveByTaskId = new Map(assignments.map(assignment => [assignment.taskId, assignment.wave]));

  const resolvedTasks: ResolvedTaskPlanTask[] = plan.tasks.map((task, originalOrder) => ({
    ...task,
    wave: waveByTaskId.get(task.id) ?? 1,
    originalOrder,
  }));

  return {
    source,
    sourcePath,
    goal: plan.goal,
    tasks: resolvedTasks,
    validation_commands: plan.validation_commands,
  };
}

export function sortResolvedTasks(tasks: ResolvedTaskPlanTask[]): ResolvedTaskPlanTask[] {
  return [...tasks].sort((a, b) => {
    if (a.wave !== b.wave) return a.wave - b.wave;
    if (a.originalOrder !== b.originalOrder) return a.originalOrder - b.originalOrder;
    return a.id.localeCompare(b.id);
  });
}

function extractFenceBlocks(content: string): string[] {
  const blocks: string[] = [];
  for (const match of content.matchAll(FENCED_BLOCK_RE)) {
    const block = match[1]?.trim();
    if (block) blocks.push(block);
  }
  return blocks;
}

function parseJsonCandidate(content: string): unknown {
  return JSON.parse(content);
}

function parseYamlCandidate(content: string): unknown {
  return parseYAML(content);
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "/");
}
