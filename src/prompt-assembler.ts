/**
 * Prompt Assembler.
 * Reference: arc42 Section 5.2.1 (PromptAssembler), 8.2 (Agent Identity and Prompt Assembly)
 *
 * Pipeline:
 *  1. Agent body (system prompt from .md file)
 *  2. L3 expertise (MEMORY.md + EXPERT.md)
 *  3. L4 knowledge graph branches (selected by domain tags)
 *  4. Skills (concatenated)
 *  5. Shared context (goal, plan, status)
 *  6. Task description
 *  7. Plan-gate instructions (if plan_first)
 *  8. Working directory
 *  9. Model tier info
 */

import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AgentDefinition, DelegationParams, SystemConfig } from "./types.js";
import type { MemorySubsystem } from "./memory/index.js";
import { atomicWrite } from "./utils.js";
import { formatUntrustedWorkspaceSection, redactSecrets } from "./security.js";

export class PromptAssembler {
  private rootDir: string;
  private config: SystemConfig;
  private memory: MemorySubsystem;

  constructor(rootDir: string, config: SystemConfig, memory: MemorySubsystem) {
    this.rootDir = rootDir;
    this.config = config;
    this.memory = memory;
  }

  assemble(agent: AgentDefinition, delegation: DelegationParams): string {
    const sections: string[] = [];

    // 1. Agent body
    sections.push("# System Prompt\n");
    sections.push(agent.body);

    // 2. L3 Expertise (MEMORY.md + EXPERT.md)
    const memoryContent = this.memory.expertise.readMemory(agent.frontmatter.name);
    const expertContent = this.memory.expertise.readExpert(agent.frontmatter.name);

    if (memoryContent) {
      sections.push("\n---\n# Agent Memory (Level 3)\n");
      sections.push(this.truncate(memoryContent, this.config.memory.expertise_token_budget));
    }
    if (expertContent) {
      sections.push("\n---\n# Domain Expertise (Level 3)\n");
      sections.push(this.truncate(expertContent, this.config.memory.expertise_token_budget));
    }

    // 3. L4 Knowledge graph branches
    const domainTags = this.extractDomainTags(agent, delegation);
    const graphContent = this.memory.knowledgeGraph.loadBranches(domainTags);
    if (graphContent) {
      sections.push("\n---\n# Knowledge Graph (Level 4)\n");
      sections.push(graphContent);
    }

    // 4. Skills
    for (const skillPath of agent.frontmatter.skills) {
      const fullPath = join(this.rootDir, skillPath);
      if (existsSync(fullPath)) {
        const skillContent = readFileSync(fullPath, "utf-8");
        sections.push(`\n---\n# Skill: ${skillPath}\n`);
        sections.push(skillContent);
      }
    }

    // 5. Shared context
    sections.push("\n---\n# Shared Context\n");
    sections.push(this.loadSharedContext());

    // 6. Task description
    sections.push("\n---\n# Current Task\n");
    sections.push(`**Task ID:** ${delegation.taskId}`);
    sections.push(`**Title:** ${delegation.taskTitle}`);
    sections.push(`**Wave:** ${delegation.wave}`);
    sections.push(`**Time Budget:** ${delegation.timeBudget}s`);
    sections.push(`\n${delegation.taskDescription}`);

    // 7. Plan-gate instructions
    if (delegation.planFirst) {
      sections.push("\n---\n# Plan-Gate Protocol\n");
      sections.push(PLAN_GATE_INSTRUCTIONS);
    }

    // 8. Working directory
    sections.push(`\n---\n**Working Directory:** ${this.rootDir}\n`);

    // 9. Model tier
    const tierPolicy = this.config.model_tier_policy[agent.frontmatter.model_tier];
    sections.push(`**Model Tier:** ${agent.frontmatter.model_tier} (primary: ${tierPolicy.primary}, fallback: ${tierPolicy.fallback})\n`);

    const assembled = redactSecrets(sections.join("\n"));

    // Write assembled prompt for auditability
    this.savePromptAudit(delegation.taskId, assembled);

    return assembled;
  }

  private loadSharedContext(): string {
    const parts: string[] = [];
    const wsDir = join(this.rootDir, this.config.paths.workspace);

    // shared-context/README.md
    const readmePath = join(this.rootDir, this.config.paths.shared_context, "README.md");
    if (existsSync(readmePath)) {
      parts.push(formatUntrustedWorkspaceSection("Shared Context", readFileSync(readmePath, "utf-8")));
    }

    // Goal
    const goalPath = join(wsDir, "goal.md");
    if (existsSync(goalPath)) {
      parts.push(formatUntrustedWorkspaceSection("Goal", readFileSync(goalPath, "utf-8")));
    }

    // Plan (summarize if too long)
    const planPath = join(wsDir, "plan.md");
    if (existsSync(planPath)) {
      const plan = readFileSync(planPath, "utf-8");
      parts.push(formatUntrustedWorkspaceSection("Plan", this.truncate(plan, 2000)));
    }

    // Status (summarize if too long)
    const statusPath = join(wsDir, "status.md");
    if (existsSync(statusPath)) {
      const status = readFileSync(statusPath, "utf-8");
      parts.push(formatUntrustedWorkspaceSection("Status", this.truncate(status, 2000)));
    }

    return parts.filter(Boolean).join("\n\n");
  }

  private extractDomainTags(agent: AgentDefinition, delegation: DelegationParams): string[] {
    const tags: string[] = [];

    // From agent's domain lock
    if (agent.frontmatter.memory.domain_lock) {
      tags.push(agent.frontmatter.memory.domain_lock);
    }

    // From task description keywords
    const keywords = ["backend", "frontend", "api", "database", "auth", "security", "testing", "devops", "planning"];
    const desc = delegation.taskDescription.toLowerCase();
    for (const kw of keywords) {
      if (desc.includes(kw)) tags.push(kw);
    }

    return [...new Set(tags)];
  }

  private truncate(content: string, tokenBudget: number): string {
    const charBudget = tokenBudget * 4; // ~4 chars per token
    if (content.length <= charBudget) return content;
    return content.slice(0, charBudget) + "\n\n_[Truncated -- full content available in source file]_";
  }

  private savePromptAudit(taskId: string, assembled: string): void {
    const dir = join(this.rootDir, this.config.paths.memory, "sessions");
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, `prompt-${taskId}.md`);
    atomicWrite(filePath, assembled);
  }
}

const PLAN_GATE_INSTRUCTIONS = `
## IMPORTANT: Plan-First Protocol

You are in **Phase 1: Planning**. DO NOT implement anything yet.

1. Read the task description carefully
2. Write your proposed approach in the "Proposed Approach" section of the task file
3. Set the task status to "plan_ready"
4. STOP and wait for approval

Your lead will review your approach and either:
- Set status to "plan_approved" → you may proceed to Phase 2 (implementation)
- Set status to "plan_revision_needed" with feedback → revise your approach

Do NOT proceed to implementation until status is "plan_approved".
`;
