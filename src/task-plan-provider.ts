/**
 * LLM-backed TaskPlan generation.
 * Reference: arc42 Section 6.1 (fallback structured decomposition)
 */

import { execFileSync } from "node:child_process";
import type { AgentResolver } from "./config.js";
import type { Logger } from "./logger.js";
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
    const curatorModels = [
      this.config.model_tier_policy.curator.primary,
      this.config.model_tier_policy.curator.fallback,
    ];
    const uniqueModels = [...new Set(curatorModels)];
    const prompt = buildPlannerPrompt(goal, this.agentResolver);
    let lastError: Error | null = null;

    for (const model of uniqueModels) {
      try {
        this.logger.logEntry("Planner", `Generating TaskPlan with ${model}`, { level: "info" });
        const output = execFileSync(
          "pi",
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
  const agents = agentResolver.getAllAgents().map(agent => {
    const role = agentResolver.getAgentRole(agent.frontmatter.name);
    const domain = agent.frontmatter.memory.domain_lock ?? "unlocked";
    return [
      `- ${agent.frontmatter.name}`,
      `  role: ${role}`,
      `  model_tier: ${agent.frontmatter.model_tier}`,
      `  delegate: ${agent.frontmatter.tools.delegate}`,
      `  domain_lock: ${domain}`,
      `  upsert: ${agent.frontmatter.domain.upsert.join(", ") || "none"}`,
    ].join("\n");
  });

  return [
    "Create a strict JSON TaskPlan for this repository goal.",
    "Output ONLY the JSON object. Do not wrap it in markdown unless absolutely necessary.",
    "Requirements:",
    '- schema_version must be 1',
    '- use stable task IDs like "task-001", "task-002", ...',
    "- include only agents from the allowed list below",
    "- depend on task IDs, never on wave numbers",
    "- plan_first should only be true when a manual plan approval gate is clearly warranted",
    "- tasks should be atomic, executable, and collectively complete the goal",
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
      "acceptance_criteria": ["string"]
    }
  ],
  "validation_commands": ["npm run build"]
}`,
    "",
    "Goal:",
    goal.trim(),
  ].join("\n");
}

const PLANNER_SYSTEM_PROMPT = [
  "You are the deterministic planning assistant for Agent Maestro.",
  "Produce a complete TaskPlan JSON object that can be validated and wave-scheduled without post-processing.",
  "Do not include commentary before or after the JSON payload.",
].join(" ");
