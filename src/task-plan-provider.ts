/**
 * LLM-backed TaskPlan generation.
 * Reference: arc42 Section 6.1 (fallback structured decomposition)
 */

import { execFileSync } from "node:child_process";
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
    const prompt = buildPlannerPrompt(extractGoalText(goal), this.agentResolver);
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

        return parseTaskPlanDocument(output);
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
