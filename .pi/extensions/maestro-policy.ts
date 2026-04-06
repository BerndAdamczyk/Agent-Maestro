import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ExtensionAPI, BashToolInput, EditToolInput, ReadToolInput, WriteToolInput } from "@mariozechner/pi-coding-agent";
import { createBashTool, createEditTool, createReadTool, createWriteTool, isToolCallEventType } from "@mariozechner/pi-coding-agent";

type AccessKind = "read" | "upsert" | "delete";

interface RuntimePolicyManifest {
  taskId: string;
  agentName: string;
  workspaceRoot: string;
  denialLogPath: string;
  allowedTools: string[];
  domain: {
    read: string[];
    upsert: string[];
    delete: string[];
  };
  deleteRoots: string[];
}

export default function (pi: ExtensionAPI) {
  const policy = loadPolicy();
  if (!policy) return;

  const cwd = policy.workspaceRoot;

  if (policy.allowedTools.includes("read")) {
    pi.registerTool(createReadTool(cwd, {
      operations: {
        async readFile(absolutePath) {
          assertAllowed(policy, "read", absolutePath);
          return readFile(absolutePath);
        },
        async access(absolutePath) {
          assertAllowed(policy, "read", absolutePath);
          return access(absolutePath);
        },
      },
    }));
  }

  if (policy.allowedTools.includes("write")) {
    pi.registerTool(createWriteTool(cwd, {
      operations: {
        async writeFile(absolutePath, content) {
          assertAllowed(policy, "upsert", absolutePath);
          await writeFile(absolutePath, content, "utf-8");
        },
        async mkdir(dir) {
          assertAllowed(policy, "upsert", dir);
          await mkdir(dir, { recursive: true });
        },
      },
    }));
  }

  if (policy.allowedTools.includes("edit")) {
    pi.registerTool(createEditTool(cwd, {
      operations: {
        async readFile(absolutePath) {
          assertAllowed(policy, "upsert", absolutePath);
          return readFile(absolutePath);
        },
        async writeFile(absolutePath, content) {
          assertAllowed(policy, "upsert", absolutePath);
          await writeFile(absolutePath, content, "utf-8");
        },
        async access(absolutePath) {
          assertAllowed(policy, "upsert", absolutePath);
          return access(absolutePath);
        },
      },
    }));
  }

  if (policy.allowedTools.includes("bash")) {
    pi.registerTool(createBashTool(cwd, {
      spawnHook: ({ command, cwd, env }) => ({
        command: `set -euo pipefail\n${command}`,
        cwd,
        env: {
          ...env,
          MAESTRO_POLICY_PATH: process.env["MAESTRO_POLICY_PATH"] ?? "",
        },
      }),
    }));
  }

  pi.on("tool_call", async event => {
    if (isToolCallEventType<"read", ReadToolInput>("read", event)) {
      return maybeBlockPath(policy, "read", event.input.path, "read");
    }

    if (isToolCallEventType<"write", WriteToolInput>("write", event)) {
      return maybeBlockPath(policy, "upsert", event.input.path, "write");
    }

    if (isToolCallEventType<"edit", EditToolInput>("edit", event)) {
      return maybeBlockPath(policy, "upsert", event.input.path, "edit");
    }

    if (isToolCallEventType<"bash", BashToolInput>("bash", event)) {
      const command = event.input.command;

      for (const pattern of ALWAYS_BLOCK_BASH_PATTERNS) {
        if (pattern.test(command)) {
          return block(policy, "bash", command, "Blocked high-risk bash command by runtime policy");
        }
      }

      if (policy.deleteRoots.length === 0 && DELETE_COMMAND_RE.test(command)) {
        return block(policy, "bash", command, "Delete operations are not permitted for this task");
      }
    }

    return undefined;
  });
}

const ALWAYS_BLOCK_BASH_PATTERNS = [
  /\bsudo\b/i,
  /\bchmod\b.*\b777\b/i,
  /\bchown\b/i,
  /\bdocker\b/i,
  /\bpodman\b/i,
  /\bmount\b/i,
  /\bumount\b/i,
  /\bcurl\b.*\|\s*(?:sh|bash)\b/i,
  /\bwget\b.*\|\s*(?:sh|bash)\b/i,
];

const DELETE_COMMAND_RE = /\b(?:rm|rmdir|unlink|find\b.*-delete|git\s+clean)\b/i;

function loadPolicy(): RuntimePolicyManifest | null {
  const policyPath = process.env["MAESTRO_POLICY_PATH"];
  if (!policyPath || !existsSync(policyPath)) return null;
  return JSON.parse(readFileSync(policyPath, "utf-8")) as RuntimePolicyManifest;
}

function maybeBlockPath(
  policy: RuntimePolicyManifest,
  accessKind: AccessKind,
  targetPath: string,
  toolName: string,
) {
  try {
    assertAllowed(policy, accessKind, targetPath);
    return undefined;
  } catch (error: any) {
    return block(policy, toolName, targetPath, error.message);
  }
}

function assertAllowed(policy: RuntimePolicyManifest, accessKind: AccessKind, targetPath: string): void {
  const relativePath = toRelativePath(policy.workspaceRoot, targetPath);
  const patterns = accessKind === "read"
    ? policy.domain.read
    : accessKind === "delete"
      ? policy.domain.delete
      : policy.domain.upsert;

  const allowed = patterns.some(pattern => matchesGlob(relativePath, pattern));
  if (!allowed) {
    throw new Error(`Path "${relativePath}" is outside the allowed ${accessKind} authority`);
  }
}

function block(policy: RuntimePolicyManifest, toolName: string, input: string, reason: string) {
  appendFileSync(policy.denialLogPath, JSON.stringify({
    ts: new Date().toISOString(),
    taskId: policy.taskId,
    agentName: policy.agentName,
    toolName,
    input,
    reason,
  }) + "\n", "utf-8");
  return { block: true, reason };
}

function toRelativePath(rootDir: string, candidate: string): string {
  const absolute = path.isAbsolute(candidate)
    ? path.normalize(candidate)
    : path.normalize(path.resolve(rootDir, candidate));
  const relativePath = path.relative(rootDir, absolute).replace(/\\/g, "/");
  return relativePath === "" ? "." : relativePath;
}

function matchesGlob(value: string, pattern: string): boolean {
  const normalizedValue = value.replace(/\\/g, "/");
  const normalizedPattern = pattern.replace(/\\/g, "/");
  if (normalizedPattern === "**" || normalizedPattern === "**/*") return true;
  const regex = globToRegExp(normalizedPattern);
  return regex.test(normalizedValue);
}

function globToRegExp(pattern: string): RegExp {
  let regex = "^";

  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]!;
    const next = pattern[i + 1];

    if (char === "*" && next === "*") {
      regex += ".*";
      i++;
      continue;
    }

    if (char === "*") {
      regex += "[^/]*";
      continue;
    }

    if (char === "?") {
      regex += ".";
      continue;
    }

    if ("/.+()|[]{}^$".includes(char)) {
      regex += `\\${char}`;
      continue;
    }

    regex += char;
  }

  regex += "$";
  return new RegExp(regex);
}
