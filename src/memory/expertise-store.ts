/**
 * Expertise Store - Level 3 Memory.
 * Reference: arc42 Section 5.2.2 (ExpertiseStore), 8.4 Level 3
 *
 * Manages MEMORY.md and EXPERT.md per agent.
 * Append-only with confidence scores. Domain-locked writes.
 */

import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AgentFrontmatter, ExpertiseEntry } from "../types.js";
import { atomicWrite, setMarkdownFrontmatterValue, upsertMarkdownSection } from "../utils.js";
import { MemoryAccessControl } from "./access-control.js";

export class ExpertiseStore {
  private agentsDir: string;
  private accessControl: MemoryAccessControl;

  constructor(memoryDir: string, accessControl: MemoryAccessControl) {
    this.agentsDir = join(memoryDir, "agents");
    this.accessControl = accessControl;
    mkdirSync(this.agentsDir, { recursive: true });
  }

  private agentDir(agentSlug: string): string {
    return join(this.agentsDir, agentSlug);
  }

  private slugify(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  ensureAgentMemory(agentName: string): void {
    const slug = this.slugify(agentName);
    const dir = this.agentDir(slug);
    mkdirSync(dir, { recursive: true });

    const memoryPath = join(dir, "MEMORY.md");
    if (!existsSync(memoryPath)) {
      const header = [
        "---",
        `agent: ${slug}`,
        `updated: ${new Date().toISOString().slice(0, 10)}`,
        "schema_version: 1",
        "---",
        "",
        "## Preferences",
        "",
        "## Patterns Learned",
        "",
        "## Strengths",
        "",
        "## Mistakes to Avoid",
        "",
        "## Collaborations",
        "",
      ].join("\n");
      atomicWrite(memoryPath, header);
    }

    const expertPath = join(dir, "EXPERT.md");
    if (!existsSync(expertPath)) {
      const header = [
        "---",
        `domain: ""`,
        `owner: ""`,
        `updated: ${new Date().toISOString().slice(0, 10)}`,
        "schema_version: 1",
        "---",
        "",
        "## Coding Standards",
        "",
        "## Architecture Patterns",
        "",
        "## Proven Heuristics",
        "",
      ].join("\n");
      atomicWrite(expertPath, header);
    }
  }

  readMemory(agentName: string): string {
    const slug = this.slugify(agentName);
    const filePath = join(this.agentDir(slug), "MEMORY.md");
    if (!existsSync(filePath)) return "";
    return readFileSync(filePath, "utf-8");
  }

  readExpert(agentName: string): string {
    const slug = this.slugify(agentName);
    const filePath = join(this.agentDir(slug), "EXPERT.md");
    if (!existsSync(filePath)) return "";
    return readFileSync(filePath, "utf-8");
  }

  appendToMemory(
    agentName: string,
    agentFrontmatter: AgentFrontmatter,
    section: "Preferences" | "Patterns Learned" | "Strengths" | "Mistakes to Avoid" | "Collaborations",
    entry: ExpertiseEntry,
  ): void {
    const accessResult = this.accessControl.check({
      agentName,
      agentFrontmatter,
      targetLevel: 3,
      targetDomain: null,
      operation: "write",
    });

    if (!accessResult.allowed) {
      throw new Error(`Memory access denied: ${accessResult.reason}`);
    }

    const slug = this.slugify(agentName);
    this.ensureAgentMemory(agentName);

    const bullet = `- **${entry.content}** (confidence: ${entry.confidence})\n  _Source: ${entry.source}, ${entry.date}_\n`;

    const filePath = join(this.agentDir(slug), "MEMORY.md");
    const current = existsSync(filePath) ? readFileSync(filePath, "utf-8") : "";
    const withEntry = upsertMarkdownSection(current, section, bullet);
    atomicWrite(filePath, setMarkdownFrontmatterValue(withEntry, "updated", entry.date));
  }

  appendToExpert(
    agentName: string,
    agentFrontmatter: AgentFrontmatter,
    targetDomain: string,
    section: "Coding Standards" | "Architecture Patterns" | "Proven Heuristics",
    entry: ExpertiseEntry,
  ): void {
    const accessResult = this.accessControl.check({
      agentName,
      agentFrontmatter,
      targetLevel: 3,
      targetDomain,
      operation: "write",
    });

    if (!accessResult.allowed) {
      throw new Error(`Memory access denied: ${accessResult.reason}`);
    }

    const slug = this.slugify(agentName);
    this.ensureAgentMemory(agentName);

    const bullet = `- **${entry.content}** (confidence: ${entry.confidence})\n  _Source: ${entry.source}, ${entry.date}_\n`;

    const filePath = join(this.agentDir(slug), "EXPERT.md");
    const current = existsSync(filePath) ? readFileSync(filePath, "utf-8") : "";
    let withEntry = upsertMarkdownSection(current, section, bullet);
    withEntry = setMarkdownFrontmatterValue(withEntry, "updated", entry.date);
    withEntry = setMarkdownFrontmatterValue(withEntry, "domain", targetDomain);
    withEntry = setMarkdownFrontmatterValue(withEntry, "owner", agentName);
    atomicWrite(filePath, withEntry);
  }

  getExpertisePath(agentName: string): string {
    return this.agentDir(this.slugify(agentName));
  }
}
