/**
 * Runtime policy manifest generation.
 * Reference: arc42 Sections 7, 8.5
 */

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { DomainRestrictions, RuntimePolicyManifest, SystemConfig, TaskPhase } from "../types.js";
import { atomicWrite } from "../utils.js";

export class RuntimePolicyManager {
  private rootDir: string;
  private config: SystemConfig;

  constructor(rootDir: string, config: SystemConfig) {
    this.rootDir = rootDir;
    this.config = config;
  }

  build(params: {
    taskId: string;
    agentName: string;
    role: "maestro" | "lead" | "worker";
    phase: TaskPhase;
    taskFilePath: string;
    allowedTools: string[];
    domain: DomainRestrictions;
    taskWriteScope?: string[];
  }): RuntimePolicyManifest {
    const effectiveDomain = deriveEffectiveDomain(
      this.rootDir,
      params.domain,
      params.taskWriteScope ?? [],
      params.phase,
      params.taskFilePath,
    );
    const allowedTools = deriveEffectiveAllowedTools(params.allowedTools, params.phase);
    const policy: RuntimePolicyManifest = {
      schema_version: 1,
      taskId: params.taskId,
      agentName: params.agentName,
      role: params.role,
      phase: params.phase,
      workspaceRoot: this.rootDir,
      taskFilePath: params.taskFilePath,
      sessionFilePath: this.getSessionFilePath(params.taskId),
      promptFilePath: this.getPromptFilePath(params.taskId),
      denialLogPath: this.getDenialLogPath(),
      allowedTools,
      domain: effectiveDomain,
      readRoots: computeAuthorityRoots(this.rootDir, effectiveDomain.read),
      writeRoots: computeAuthorityRoots(this.rootDir, [...effectiveDomain.upsert, ...effectiveDomain.delete]),
      deleteRoots: computeAuthorityRoots(this.rootDir, effectiveDomain.delete),
    };

    mkdirSync(dirname(this.getPolicyManifestPath(params.taskId)), { recursive: true });
    atomicWrite(this.getPolicyManifestPath(params.taskId), JSON.stringify(policy, null, 2));
    return policy;
  }

  getPolicyManifestPath(taskId: string): string {
    return join(this.rootDir, this.config.paths.workspace, "runtime-policies", `${taskId}.json`);
  }

  getSessionFilePath(taskId: string): string {
    return join(this.rootDir, this.config.paths.workspace, "runtime-sessions", `${taskId}.jsonl`);
  }

  getPromptFilePath(taskId: string): string {
    return join(this.rootDir, this.config.paths.memory, "sessions", `prompt-${taskId}.md`);
  }

  getTurnMessagesDir(): string {
    return join(this.rootDir, this.config.paths.workspace, "runtime-turns");
  }

  getPolicyExtensionPath(): string {
    return join(this.rootDir, "dist", "src", "runtime", "maestro-policy-extension.js");
  }

  getDenialLogPath(): string {
    return join(this.rootDir, "logs", "policy-denials.jsonl");
  }
}

function deriveEffectiveDomain(
  rootDir: string,
  domain: DomainRestrictions,
  taskWriteScope: string[],
  phase: TaskPhase,
  taskFilePath: string,
): DomainRestrictions {
  const scopedDomain: DomainRestrictions = taskWriteScope.length === 0
    ? domain
    : {
      read: domain.read,
      upsert: uniquePatterns(["workspace/**", ...taskWriteScope]),
      delete: domain.delete,
    };

  if (phase !== "phase_1_plan") {
    return scopedDomain;
  }

  const relativeTaskFilePath = normalizeRelativePattern(relative(rootDir, taskFilePath));
  return {
    read: scopedDomain.read,
    upsert: uniquePatterns([relativeTaskFilePath]),
    delete: [],
  };
}

function deriveEffectiveAllowedTools(allowedTools: string[], phase: TaskPhase): string[] {
  if (phase !== "phase_1_plan") {
    return allowedTools;
  }

  return allowedTools.filter(tool => tool === "read" || tool === "write" || tool === "edit");
}

function uniquePatterns(patterns: string[]): string[] {
  return [...new Set(patterns.map(pattern => normalizeRelativePattern(pattern)).filter(Boolean))];
}

function normalizeRelativePattern(pattern: string): string {
  return pattern.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/");
}

export function computeAuthorityRoots(rootDir: string, patterns: string[]): string[] {
  const roots = new Set<string>();

  for (const pattern of patterns) {
    const root = extractMountRoot(pattern);
    const existingRoot = findExistingRoot(rootDir, root);
    roots.add(existingRoot);
  }

  return [...roots].sort((a, b) => a.localeCompare(b));
}

function extractMountRoot(pattern: string): string {
  const normalized = pattern.trim().replace(/\\/g, "/");
  if (!normalized || normalized === "." || normalized === "**" || normalized === "**/*" || normalized === "*") {
    return ".";
  }

  const wildcardIndex = normalized.search(/[\*\?\[\{]/);
  const prefix = wildcardIndex >= 0 ? normalized.slice(0, wildcardIndex) : normalized;
  const withoutTrailing = prefix.replace(/\/+$/, "");
  if (!withoutTrailing) return ".";

  const lastSlash = withoutTrailing.lastIndexOf("/");
  if (wildcardIndex < 0) {
    return withoutTrailing;
  }

  return lastSlash >= 0 ? withoutTrailing.slice(0, lastSlash) || "." : withoutTrailing;
}

function findExistingRoot(rootDir: string, relativePath: string): string {
  let current = relativePath;

  while (current !== "." && current !== "") {
    const candidate = join(rootDir, current);
    if (existsSync(candidate)) {
      return normalizeRelativeRoot(rootDir, candidate);
    }
    const parent = dirname(current);
    current = parent === current ? "." : parent;
  }

  return ".";
}

function normalizeRelativeRoot(rootDir: string, absolutePath: string): string {
  const rel = relative(rootDir, absolutePath).replace(/\\/g, "/");
  return rel === "" ? "." : rel;
}
