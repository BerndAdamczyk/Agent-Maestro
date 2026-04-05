/**
 * Config Loader and Agent Resolver.
 * Reference: arc42 Section 5.2.1 (ConfigLoader, AgentResolver), 8.15 (Configuration Management)
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYAML } from "yaml";
import {
  SystemConfigSchema,
  AgentFrontmatterSchema,
  type SystemConfig,
  type AgentDefinition,
  type AgentFrontmatter,
} from "./types.js";

// ── Frontmatter Parser ───────────────────────────────────────────────

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

export function parseFrontmatter(content: string): { yaml: Record<string, unknown>; body: string } {
  const match = content.match(FRONTMATTER_RE);
  if (!match) {
    throw new Error("No YAML frontmatter found (expected --- delimiters)");
  }
  const yaml = parseYAML(match[1]!) as Record<string, unknown>;
  const body = match[2]!.trim();
  return { yaml, body };
}

// ── Config Loader ────────────────────────────────────────────────────

export function loadConfig(rootDir: string): SystemConfig {
  const configPath = join(rootDir, "multi-team-config.yaml");
  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const raw = readFileSync(configPath, "utf-8");
  const parsed = parseYAML(raw) as Record<string, unknown>;
  const config = SystemConfigSchema.parse(parsed);

  // Validate referenced files exist
  validateConfig(rootDir, config);

  return config;
}

function validateConfig(rootDir: string, config: SystemConfig): void {
  const errors: string[] = [];

  // Check maestro agent file exists
  const maestroPath = join(rootDir, config.paths.agents, config.maestro.file);
  if (!existsSync(maestroPath)) {
    errors.push(`Maestro agent file not found: ${maestroPath}`);
  }

  for (const team of config.teams) {
    // Check lead agent file
    const leadPath = join(rootDir, config.paths.agents, team.lead.file);
    if (!existsSync(leadPath)) {
      errors.push(`Team '${team.name}' lead agent file not found: ${leadPath}`);
    } else {
      // Check lead has delegate tool
      const leadDef = readAgentFile(join(rootDir, config.paths.agents, team.lead.file));
      if (leadDef && !leadDef.frontmatter.tools.delegate) {
        errors.push(`Team '${team.name}' lead '${team.lead.name}' must have delegate: true`);
      }
    }

    // Check worker agent files
    for (const worker of team.workers) {
      const workerPath = join(rootDir, config.paths.agents, worker.file);
      if (!existsSync(workerPath)) {
        errors.push(`Team '${team.name}' worker agent file not found: ${workerPath}`);
      }
    }
  }

  // Check skill files referenced by agents
  const allAgentFiles = getAllAgentFiles(rootDir, config);
  for (const agentFile of allAgentFiles) {
    const agentPath = join(rootDir, config.paths.agents, agentFile);
    if (!existsSync(agentPath)) continue;

    const def = readAgentFile(agentPath);
    if (!def) continue;

    for (const skillPath of def.frontmatter.skills) {
      const fullSkillPath = join(rootDir, skillPath);
      if (!existsSync(fullSkillPath)) {
        errors.push(`Agent '${def.frontmatter.name}' references missing skill: ${skillPath}`);
      }
    }

    // Validate memory write_levels consistency with agent role
    const isWorker = !def.frontmatter.tools.delegate;
    if (isWorker) {
      const hasHighLevelWrite = def.frontmatter.memory.write_levels.some(l => l > 2);
      if (hasHighLevelWrite) {
        errors.push(
          `Worker agent '${def.frontmatter.name}' has write access to memory levels > 2 (only Maestro/Leads can write L3/L4)`
        );
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Config validation failed:\n  - ${errors.join("\n  - ")}`);
  }
}

function getAllAgentFiles(rootDir: string, config: SystemConfig): string[] {
  const files = new Set<string>();
  files.add(config.maestro.file);
  for (const team of config.teams) {
    files.add(team.lead.file);
    for (const worker of team.workers) {
      files.add(worker.file);
    }
  }
  return [...files];
}

// ── Agent File Reader ────────────────────────────────────────────────

function readAgentFile(filePath: string): AgentDefinition | null {
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, "utf-8");
  const { yaml, body } = parseFrontmatter(content);
  const frontmatter = AgentFrontmatterSchema.parse(yaml);
  return { frontmatter, body, filePath };
}

// ── Agent Resolver ───────────────────────────────────────────────────

export class AgentResolver {
  private rootDir: string;
  private config: SystemConfig;
  private cache = new Map<string, AgentDefinition>();

  constructor(rootDir: string, config: SystemConfig) {
    this.rootDir = rootDir;
    this.config = config;
  }

  readAgent(filePath: string): AgentDefinition {
    const absPath = resolve(this.rootDir, filePath);
    const cached = this.cache.get(absPath);
    if (cached) return cached;

    const def = readAgentFile(absPath);
    if (!def) throw new Error(`Agent file not found: ${absPath}`);
    this.cache.set(absPath, def);
    return def;
  }

  findAgentByName(name: string): AgentDefinition | null {
    // Check maestro
    if (this.config.maestro.name === name) {
      return this.readAgent(join(this.config.paths.agents, this.config.maestro.file));
    }

    // Check teams
    for (const team of this.config.teams) {
      if (team.lead.name === name) {
        return this.readAgent(join(this.config.paths.agents, team.lead.file));
      }
      for (const worker of team.workers) {
        if (worker.name === name) {
          return this.readAgent(join(this.config.paths.agents, worker.file));
        }
      }
    }

    return null;
  }

  getAllAgents(): AgentDefinition[] {
    const agents: AgentDefinition[] = [];

    agents.push(this.readAgent(join(this.config.paths.agents, this.config.maestro.file)));

    for (const team of this.config.teams) {
      agents.push(this.readAgent(join(this.config.paths.agents, team.lead.file)));
      for (const worker of team.workers) {
        agents.push(this.readAgent(join(this.config.paths.agents, worker.file)));
      }
    }

    return agents;
  }

  getAgentHierarchyLevel(agentName: string): number {
    if (this.config.maestro.name === agentName) return 1;

    for (const team of this.config.teams) {
      if (team.lead.name === agentName) return 2;
      for (const worker of team.workers) {
        if (worker.name === agentName) return 3;
      }
    }

    return -1;
  }

  getAgentRole(agentName: string): "maestro" | "lead" | "worker" {
    if (this.config.maestro.name === agentName) return "maestro";

    for (const team of this.config.teams) {
      if (team.lead.name === agentName) return "lead";
    }

    return "worker";
  }

  getTeamForAgent(agentName: string): string | null {
    for (const team of this.config.teams) {
      if (team.lead.name === agentName) return team.name;
      for (const worker of team.workers) {
        if (worker.name === agentName) return team.name;
      }
    }
    return null;
  }

  getAgentColor(agentName: string): string {
    if (this.config.maestro.name === agentName) return this.config.maestro.color;

    for (const team of this.config.teams) {
      if (team.lead.name === agentName) return team.lead.color;
      for (const worker of team.workers) {
        if (worker.name === agentName) return worker.color;
      }
    }

    return "#438DD5";
  }

  clearCache(): void {
    this.cache.clear();
  }
}
