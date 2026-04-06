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
  }): RuntimePolicyManifest {
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
      allowedTools: params.allowedTools,
      domain: params.domain,
      readRoots: computeAuthorityRoots(this.rootDir, params.domain.read),
      writeRoots: computeAuthorityRoots(this.rootDir, [...params.domain.upsert, ...params.domain.delete]),
      deleteRoots: computeAuthorityRoots(this.rootDir, params.domain.delete),
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
    return join(this.rootDir, ".pi", "extensions", "maestro-policy.ts");
  }

  getDenialLogPath(): string {
    return join(this.rootDir, "logs", "policy-denials.jsonl");
  }
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
