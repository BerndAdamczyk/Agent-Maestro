/**
 * LLM-backed TaskPlan generation.
 * Reference: arc42 Section 6.1 (fallback structured decomposition)
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { AgentResolver } from "./config.js";
import type { Logger } from "./logger.js";
import { resolvePiCommand } from "./pi-runtime-support.js";
import { parseTaskPlanDocument } from "./task-plan.js";
import type { SystemConfig, TaskPlan } from "./types.js";

export class TaskPlanProvider {
  private rootDir: string;
  private config: SystemConfig;
  private agentResolver: AgentResolver;
  private logger: Logger;

  constructor(rootDir: string, config: SystemConfig, agentResolver: AgentResolver, logger: Logger) {
    this.rootDir = rootDir;
    this.config = config;
    this.agentResolver = agentResolver;
    this.logger = logger;
  }

  generate(goal: string): TaskPlan {
    const builtinPlan = buildBuiltinTaskPlanIfApplicable(goal);
    if (builtinPlan) {
      this.logger.logEntry("Planner", "Using built-in TaskPlan for health-check goal", { level: "info" });
      return builtinPlan;
    }

    const curatorModels = [
      this.config.model_tier_policy.curator.primary,
      this.config.model_tier_policy.curator.fallback,
    ];
    const uniqueModels = [...new Set(curatorModels)];
    const normalizedGoal = normalizeExplicitRepoPathText(goal, this.rootDir);
    logPathRewrites(this.logger, "goal", normalizedGoal.rewrites);
    if (normalizedGoal.unresolved.length > 0) {
      throw new Error(
        `Goal references missing explicit repo paths: ${normalizedGoal.unresolved.join(", ")}`
      );
    }
    const prompt = buildPlannerPrompt(extractGoalText(normalizedGoal.text), this.agentResolver);
    const piCommand = resolvePiCommand();
    let lastError: Error | null = null;

    for (const model of uniqueModels) {
      try {
        this.logger.logEntry("Planner", `Generating TaskPlan with ${model}`, { level: "info" });
        const output = execFileSync(
          piCommand,
          [
            "-p",
            "--no-tools",
            "--no-session",
            "--model",
            model,
            "--thinking",
            "high",
            "--system-prompt",
            PLANNER_SYSTEM_PROMPT,
            prompt,
          ],
          {
            cwd: this.rootDir,
            encoding: "utf-8",
            stdio: ["ignore", "pipe", "pipe"],
            timeout: 5 * 60 * 1000,
          },
        );

        const parsed = parseTaskPlanDocument(output);
        const normalizedPlan = normalizeTaskPlanExplicitRepoPaths(parsed, this.rootDir);
        logPathRewrites(this.logger, "task plan", normalizedPlan.rewrites);
        if (normalizedPlan.unresolved.length > 0) {
          throw new Error(
            `Generated TaskPlan references missing explicit repo paths: ${normalizedPlan.unresolved.join(", ")}`
          );
        }
        return normalizedPlan.plan;
      } catch (error: any) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
        this.logger.logEntry(
          "Planner",
          `TaskPlan generation failed for ${model}${stderr ? `: ${stderr}` : ""}`,
          { level: "warn" },
        );
      }
    }

    throw new Error(
      `Unable to generate TaskPlan from the configured curator models. ${lastError?.message ?? "No model attempt succeeded."}`,
    );
  }
}

function buildPlannerPrompt(goal: string, agentResolver: AgentResolver): string {
  const agents = agentResolver.getAllAgents().flatMap(agent => {
    const role = agentResolver.getAgentRole(agent.frontmatter.name);
    if (role === "maestro") {
      return [];
    }
    const domain = agent.frontmatter.memory.domain_lock ?? "unlocked";
    return [[
      `- ${agent.frontmatter.name}`,
      `  role: ${role}`,
      `  model_tier: ${agent.frontmatter.model_tier}`,
      `  delegate: ${agent.frontmatter.tools.delegate}`,
      `  domain_lock: ${domain}`,
      `  upsert: ${agent.frontmatter.domain.upsert.join(", ") || "none"}`,
    ].join("\n")];
  });

  return [
    "Create a strict JSON TaskPlan for this repository goal.",
    "Output ONLY the JSON object. Do not wrap it in markdown unless absolutely necessary.",
    "Do not assign implementation tasks to Maestro; Maestro is the orchestrator, not a task assignee.",
    "Requirements:",
    '- schema_version must be 1',
    '- use stable task IDs like "task-001", "task-002", ...',
    "- include only agents from the allowed list below",
    "- depend on task IDs, never on wave numbers",
    "- plan_first should only be true when a manual plan approval gate is clearly warranted",
    "- tasks should be atomic, executable, and collectively complete the goal",
    "- every task must declare a non-empty write_scope with the repo-relative files/directories it is allowed to modify",
    "- same-wave tasks must not overlap write_scope outside workspace/",
    "- include docs paths explicitly when documentation updates are required; do not hide them in generic prose",
    "- prefer the smallest practical write_scope over broad roots like src/** when a narrower subtree or file is known",
    "- validation_commands should contain repo-level verification commands when appropriate",
    "",
    "Allowed agents:",
    agents.join("\n"),
    "",
    "JSON schema shape:",
    `{
  "schema_version": 1,
  "goal": "string",
  "tasks": [
    {
      "id": "task-001",
      "title": "string",
      "description": "string",
      "assigned_to": "Allowed Agent Name",
      "task_type": "planning|implementation|validation|security|qa|research|general",
      "dependencies": ["task-000"],
      "parent_task": null,
      "plan_first": false,
      "time_budget": 600,
      "acceptance_criteria": ["string"],
      "write_scope": ["src/runtime/**"]
    }
  ],
  "validation_commands": ["npm run build"]
}`,
    "",
    "Goal:",
    goal.trim(),
  ].join("\n");
}

export function buildBuiltinTaskPlanIfApplicable(goal: string): TaskPlan | null {
  const normalizedGoal = extractGoalText(goal).trim().toLowerCase();
  if (!/^(ping|pong|health ?check|smoke ?test)$/.test(normalizedGoal)) {
    return null;
  }

  return {
    schema_version: 1,
    goal: extractGoalText(goal).trim() || "ping",
    tasks: [
      {
        id: "task-001",
        title: "Acknowledge ping",
        description: "Verify the system is responsive by producing a pong acknowledgement file in the workspace.",
        assigned_to: "Product Manager",
        task_type: "general",
        dependencies: [],
        parent_task: null,
        plan_first: false,
        time_budget: 60,
        acceptance_criteria: [
          "workspace/pong.md exists",
          "workspace/pong.md contains the word 'pong'",
        ],
        write_scope: [
          "workspace/pong.md",
        ],
      },
    ],
    validation_commands: [
      "test -f workspace/pong.md && grep -qi 'pong' workspace/pong.md && echo 'PASS'",
    ],
  };
}

const EXPLICIT_REPO_PATH_RE = /\.\/((?:docs|src|web|tests|agents|skills|shared-context|\.pi)\/[^\s`"'()<>\]]+)/g;
const VALIDATED_EXPLICIT_ROOTS = new Set(["docs", "src", "web", "tests", "agents", "skills", "shared-context", ".pi"]);

export function normalizeExplicitRepoPathText(
  text: string,
  rootDir: string,
): { text: string; rewrites: Array<{ from: string; to: string }>; unresolved: string[] } {
  const pathIndex = buildRepoPathIndex(rootDir);
  const rewrites: Array<{ from: string; to: string }> = [];
  const unresolved = new Set<string>();

  const nextText = text.replace(EXPLICIT_REPO_PATH_RE, (match, relativePath: string) => {
    const { pathText, trailingPunctuation } = splitTrailingPathPunctuation(relativePath);
    const normalized = normalizeRepoPath(pathText);
    if (!shouldValidateExplicitRepoPath(normalized)) {
      return match;
    }
    if (existsSync(join(rootDir, normalized))) {
      return `./${normalized}${trailingPunctuation}`;
    }

    const suggestion = findClosestRepoPath(normalized, pathIndex);
    if (!suggestion) {
      unresolved.add(`./${normalized}${trailingPunctuation}`);
      return match;
    }

    const replacement = `./${suggestion}${trailingPunctuation}`;
    rewrites.push({ from: match, to: replacement });
    return replacement;
  });

  return {
    text: nextText,
    rewrites,
    unresolved: [...unresolved],
  };
}

export function normalizeTaskPlanExplicitRepoPaths(
  plan: TaskPlan,
  rootDir: string,
): {
  plan: TaskPlan;
  rewrites: Array<{ from: string; to: string }>;
  unresolved: string[];
} {
  const goal = normalizeExplicitRepoPathText(plan.goal, rootDir);
  const rewrites = [...goal.rewrites];
  const unresolved = [...goal.unresolved];

  const tasks = plan.tasks.map(task => {
    const description = normalizeExplicitRepoPathText(task.description, rootDir);
    const acceptanceCriteria = task.acceptance_criteria.map(criterion => normalizeExplicitRepoPathText(criterion, rootDir));
    const writeScope = task.write_scope.map(scope => normalizeExplicitRepoPathText(scope, rootDir));

    rewrites.push(
      ...description.rewrites,
      ...acceptanceCriteria.flatMap(item => item.rewrites),
      ...writeScope.flatMap(item => item.rewrites),
    );
    unresolved.push(
      ...description.unresolved,
      ...acceptanceCriteria.flatMap(item => item.unresolved),
      ...writeScope.flatMap(item => item.unresolved),
    );

    return {
      ...task,
      description: description.text,
      acceptance_criteria: acceptanceCriteria.map(item => item.text),
      write_scope: writeScope.map(item => item.text),
    };
  });

  const validationCommands = plan.validation_commands.map(command => normalizeExplicitRepoPathText(command, rootDir));
  rewrites.push(...validationCommands.flatMap(item => item.rewrites));
  unresolved.push(...validationCommands.flatMap(item => item.unresolved));

  return {
    plan: {
      ...plan,
      goal: goal.text,
      tasks,
      validation_commands: validationCommands.map(item => item.text),
    },
    rewrites,
    unresolved: [...new Set(unresolved)],
  };
}

function logPathRewrites(
  logger: Logger,
  scope: string,
  rewrites: Array<{ from: string; to: string }>,
): void {
  if (rewrites.length === 0) return;
  const summary = rewrites
    .slice(0, 4)
    .map(rewrite => `${rewrite.from} -> ${rewrite.to}`)
    .join("; ");
  logger.logEntry("Planner", `Normalized explicit repo paths in ${scope}: ${summary}`, { level: "warn" });
}

function buildRepoPathIndex(rootDir: string): Map<string, string[]> {
  const index = new Map<string, string[]>();

  for (const root of VALIDATED_EXPLICIT_ROOTS) {
    const absoluteRoot = join(rootDir, root);
    if (!existsSync(absoluteRoot)) continue;
    index.set(root, collectRepoFilePaths(absoluteRoot, root));
  }

  return index;
}

function collectRepoFilePaths(absoluteDir: string, relativeDir: string): string[] {
  const entries = readdirSync(absoluteDir, { withFileTypes: true });
  const paths: string[] = [];

  for (const entry of entries) {
    const relativePath = `${relativeDir}/${entry.name}`.replace(/\\/g, "/");
    if (entry.isDirectory()) {
      paths.push(...collectRepoFilePaths(join(absoluteDir, entry.name), relativePath));
      continue;
    }

    if (entry.isFile()) {
      paths.push(relativePath);
    }
  }

  return paths;
}

function shouldValidateExplicitRepoPath(relativePath: string): boolean {
  if (!relativePath || hasGlob(relativePath)) return false;
  const root = relativePath.split("/", 1)[0] ?? "";
  return VALIDATED_EXPLICIT_ROOTS.has(root);
}

function normalizeRepoPath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

function splitTrailingPathPunctuation(value: string): { pathText: string; trailingPunctuation: string } {
  const match = value.match(/^(.*?)([.,;:]+)?$/);
  return {
    pathText: match?.[1] ?? value,
    trailingPunctuation: match?.[2] ?? "",
  };
}

function hasGlob(value: string): boolean {
  return /[*?[\]{}]/.test(value);
}

function findClosestRepoPath(targetPath: string, index: Map<string, string[]>): string | null {
  const root = targetPath.split("/", 1)[0] ?? "";
  const candidates = index.get(root) ?? [];
  if (candidates.length === 0) return null;

  const normalizedTarget = similarityKey(targetPath);
  let bestPath: string | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  let secondScore = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const score = levenshtein(normalizedTarget, similarityKey(candidate));
    if (score < bestScore) {
      secondScore = bestScore;
      bestScore = score;
      bestPath = candidate;
      continue;
    }
    if (score < secondScore) {
      secondScore = score;
    }
  }

  const threshold = Math.max(2, Math.floor(normalizedTarget.length * 0.12));
  if (!bestPath || bestScore > threshold) {
    return null;
  }
  if (secondScore < Number.POSITIVE_INFINITY && secondScore - bestScore < 2) {
    return null;
  }

  return bestPath;
}

function similarityKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function levenshtein(left: string, right: string): number {
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = new Array<number>(right.length + 1);

  for (let i = 0; i < left.length; i += 1) {
    current[0] = i + 1;
    for (let j = 0; j < right.length; j += 1) {
      const substitutionCost = left[i] === right[j] ? 0 : 1;
      current[j + 1] = Math.min(
        current[j]! + 1,
        previous[j + 1]! + 1,
        previous[j]! + substitutionCost,
      );
    }
    for (let j = 0; j < current.length; j += 1) {
      previous[j] = current[j]!;
    }
  }

  return previous[right.length]!;
}

function extractGoalText(goal: string): string {
  const lines = goal
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => line !== "# Goal" && !/^_Created:/i.test(line));

  return lines.join("\n");
}

const PLANNER_SYSTEM_PROMPT = [
  "You are the deterministic planning assistant for Agent Maestro.",
  "Produce a complete TaskPlan JSON object that can be validated and wave-scheduled without post-processing.",
  "Do not include commentary before or after the JSON payload.",
].join(" ");
