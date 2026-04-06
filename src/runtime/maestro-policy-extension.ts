// @ts-nocheck

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import type { ExtensionAPI, BashToolInput, EditToolInput, ReadToolInput, WriteToolInput } from "@mariozechner/pi-coding-agent";
import { createBashTool, createEditTool, createReadTool, createWriteTool, isToolCallEventType } from "@mariozechner/pi-coding-agent";

type AccessKind = "read" | "upsert" | "delete";

interface RuntimePolicyManifest {
  taskId: string;
  agentName: string;
  phase: "phase_1_plan" | "phase_2_execute" | "none";
  workspaceRoot: string;
  denialLogPath: string;
  allowedTools: string[];
  domain: {
    read: string[];
    upsert: string[];
    delete: string[];
  };
  writeRoots: string[];
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
      const validation = validateBashCommand(policy, event.input.command);
      if (validation) {
        return block(policy, "bash", event.input.command, validation);
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
const MUTATING_BASH_RE = /(?:^|[;&|]\s*)(?:cp|mv|touch|mkdir|install|tee|truncate|dd|cat\s+.*>|printf\s+.*>|echo\s+.*>|sed\s+-i|perl\s+-pi|python\s+.*(?:write_text|write_bytes)|node\s+.*(?:writeFile|appendFile)|git\s+apply|git\s+am|patch|rm|rmdir|unlink)\b/i;
const SAFE_PHASE1_BASH_RE = /^\s*(?:pwd|ls|cat|sed(?!\s+-i)|head|tail|grep|rg|find|git\s+status|git\s+diff|npm\s+run\s+(?:build|lint|test)|node\s+--test)\b/i;
const TOKEN_SPLIT_RE = /\s+/g;

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

export function assertAllowed(policy: RuntimePolicyManifest, accessKind: AccessKind, targetPath: string): void {
  const { resolvedRelativePath } = resolveAuthorizedPath(policy.workspaceRoot, targetPath);
  const patterns = accessKind === "read"
    ? policy.domain.read
    : accessKind === "delete"
      ? policy.domain.delete
      : policy.domain.upsert;

  const allowed = patterns.some(pattern => matchesGlob(resolvedRelativePath, pattern));
  if (!allowed) {
    throw new Error(`Path "${resolvedRelativePath}" is outside the allowed ${accessKind} authority`);
  }
}

export function validateBashCommand(policy: RuntimePolicyManifest, command: string): string | null {
  const statements = splitShellCommandSegments(command);

  for (const pattern of ALWAYS_BLOCK_BASH_PATTERNS) {
    if (pattern.test(command)) {
      return "Blocked high-risk bash command by runtime policy";
    }
  }

  if (isShellWrapperInvocation(command)) {
    return "Shell-wrapper bash commands are not permitted by runtime policy";
  }

  const shellSyntax = inspectShellSyntax(command);
  if (shellSyntax.hasPipeChain) {
    return "Pipe chains are not permitted by runtime policy";
  }

  if (shellSyntax.hasCommandSubstitution) {
    return "Command substitution is not permitted by runtime policy";
  }

  if (policy.phase === "phase_1_plan") {
    for (const statement of statements) {
      if (!SAFE_PHASE1_BASH_RE.test(statement)) {
        return "Phase 1 planning only permits read-only bash commands";
      }
      if (MUTATING_BASH_RE.test(statement)) {
        return "Phase 1 planning forbids bash-based file mutations";
      }
    }
    return null;
  }

  if (policy.deleteRoots.length === 0 && DELETE_COMMAND_RE.test(command)) {
    return "Delete operations are not permitted for this task";
  }

  if (!statements.some(statement => MUTATING_BASH_RE.test(statement))) {
    return null;
  }

  const referencedPaths = extractReferencedPaths(command);
  if (referencedPaths.length === 0) {
    return "Blocked mutating bash command because no in-scope target path could be verified";
  }

  for (const referencedPath of referencedPaths) {
    try {
      assertAllowed(policy, isDeleteLikePath(command, referencedPath) ? "delete" : "upsert", referencedPath);
    } catch (error: any) {
      return error.message;
    }
  }

  return null;
}

const SHELL_WRAPPER_EXECUTABLES = new Set(["sh", "bash", "zsh", "dash", "python", "python3", "perl", "ruby", "node", "env"]);

function isShellWrapperInvocation(command: string): boolean {
  return splitShellCommandSegments(command).some(segment => isShellWrapperSegment(segment));
}

function isShellWrapperSegment(segment: string): boolean {
  const tokens = tokenizeShellCommand(segment);
  if (tokens.length === 0) return false;

  let executableIndex = 0;
  while (executableIndex < tokens.length && isEnvironmentAssignment(tokens[executableIndex]!)) {
    executableIndex += 1;
  }

  if (executableIndex >= tokens.length) return false;
  const executable = path.basename(tokens[executableIndex]!).toLowerCase();
  return SHELL_WRAPPER_EXECUTABLES.has(executable);
}

function splitShellCommandSegments(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let singleQuoted = false;
  let doubleQuoted = false;
  let escaped = false;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!;
    const next = command[index + 1];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\" && !singleQuoted) {
      escaped = true;
      continue;
    }

    if (char === "'" && !doubleQuoted) {
      singleQuoted = !singleQuoted;
      continue;
    }

    if (char === '"' && !singleQuoted) {
      doubleQuoted = !doubleQuoted;
      continue;
    }

    if (!singleQuoted && !doubleQuoted) {
      if (char === ";" || char === "\n") {
        const trimmed = current.trim();
        if (trimmed) segments.push(trimmed);
        current = "";
        continue;
      }

      if (char === "&" && next === "&") {
        const trimmed = current.trim();
        if (trimmed) segments.push(trimmed);
        current = "";
        index += 1;
        continue;
      }

      if (char === "|" && next === "|") {
        const trimmed = current.trim();
        if (trimmed) segments.push(trimmed);
        current = "";
        index += 1;
        continue;
      }
    }

    current += char;
  }

  const trimmed = current.trim();
  if (trimmed) segments.push(trimmed);
  return segments;
}

function inspectShellSyntax(command: string): { hasPipeChain: boolean; hasCommandSubstitution: boolean } {
  let singleQuoted = false;
  let doubleQuoted = false;
  let escaped = false;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!;
    const next = command[index + 1];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\" && !singleQuoted) {
      escaped = true;
      continue;
    }

    if (char === "'" && !doubleQuoted) {
      singleQuoted = !singleQuoted;
      continue;
    }

    if (char === '"' && !singleQuoted) {
      doubleQuoted = !doubleQuoted;
      continue;
    }

    if (singleQuoted) continue;

    if (char === "|" && !doubleQuoted) {
      if (next === "|") {
        index += 1;
        continue;
      }

      return {
        hasPipeChain: true,
        hasCommandSubstitution: false,
      };
    }

    if (char === "$" && next === "(") {
      return {
        hasPipeChain: false,
        hasCommandSubstitution: true,
      };
    }

    if (char === "`") {
      return {
        hasPipeChain: false,
        hasCommandSubstitution: true,
      };
    }
  }

  return {
    hasPipeChain: false,
    hasCommandSubstitution: false,
  };
}

function tokenizeShellCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let singleQuoted = false;
  let doubleQuoted = false;
  let escaped = false;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!;

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\" && !singleQuoted) {
      escaped = true;
      continue;
    }

    if (char === "'" && !doubleQuoted) {
      singleQuoted = !singleQuoted;
      continue;
    }

    if (char === '"' && !singleQuoted) {
      doubleQuoted = !doubleQuoted;
      continue;
    }

    if (!singleQuoted && !doubleQuoted && /\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function isEnvironmentAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=.*$/.test(token);
}

function resolveAuthorizedPath(rootDir: string, candidate: string): { resolvedRoot: string; resolvedTarget: string; resolvedRelativePath: string } {
  const resolvedRoot = realpathSync(path.resolve(rootDir));
  const resolvedTarget = resolveThroughRealFilesystem(path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(rootDir, candidate));
  const resolvedRelativePath = path.relative(resolvedRoot, resolvedTarget).replace(/\\/g, "/") || ".";
  return {
    resolvedRoot,
    resolvedTarget,
    resolvedRelativePath,
  };
}

function resolveThroughRealFilesystem(targetPath: string): string {
  let current = path.resolve(targetPath);
  const missingSegments: string[] = [];

  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }

    missingSegments.unshift(path.basename(current));
    current = parent;
  }

  const resolvedBase = realpathSync(current);
  return missingSegments.reduce((accumulator, segment) => path.join(accumulator, segment), resolvedBase);
}

function extractReferencedPaths(command: string): string[] {
  const normalized = command
    .replace(/&&|\|\||[;(){}]/g, " ")
    .replace(/(^|\s)2?>\s*([^\s]+)/g, "$1 $2 ")
    .replace(/(^|\s)<<\s*[^\s]+/g, " ");

  const tokens = normalized
    .split(TOKEN_SPLIT_RE)
    .map(token => token.trim())
    .filter(Boolean)
    .map(stripShellQuotes);

  const paths = new Set<string>();

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const next = tokens[index + 1] ?? "";

    if (["cp", "mv", "install", "patch"].includes(token) && next) {
      const destination = tokens[index + 2] ?? "";
      if (looksLikePath(destination)) paths.add(destination);
      continue;
    }

    if (["touch", "mkdir", "truncate", "tee", "rm", "rmdir", "unlink"].includes(token) && next) {
      if (looksLikePath(next)) paths.add(next);
      continue;
    }

    if ((token === "sed" && next === "-i") || (token === "perl" && next === "-pi")) {
      const candidate = tokens[index + 2] ?? "";
      if (looksLikePath(candidate)) paths.add(candidate);
      continue;
    }

    if (looksLikeStandaloneRedirectTarget(token)) {
      paths.add(token);
    }
  }

  return [...paths];
}

function isDeleteLikePath(command: string, referencedPath: string): boolean {
  const escaped = referencedPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b(?:rm|rmdir|unlink)\\b[^\\n]*${escaped}`).test(command);
}

function looksLikePath(value: string): boolean {
  if (!value || value.startsWith("-")) return false;
  if (/^(?:[A-Za-z_][A-Za-z0-9_]*=|https?:\/\/)/.test(value)) return false;
  return value.includes("/") || value.includes(".") || value.startsWith("~");
}

function looksLikeStandaloneRedirectTarget(value: string): boolean {
  return looksLikePath(value) && !/^[<>|]/.test(value);
}

function stripShellQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, "");
}

function block(policy: RuntimePolicyManifest, toolName: string, input: string, reason: string) {
  mkdirSync(path.dirname(policy.denialLogPath), { recursive: true });
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
  if (matchesDirectoryRoot(normalizedValue, normalizedPattern)) return true;
  const regex = globToRegExp(normalizedPattern);
  return regex.test(normalizedValue);
}

function matchesDirectoryRoot(value: string, pattern: string): boolean {
  for (const suffix of ["/**/*", "/**"]) {
    if (!pattern.endsWith(suffix)) continue;
    const root = pattern.slice(0, -suffix.length);
    if (!root) return true;
    return value === root || value.startsWith(`${root}/`);
  }

  return false;
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
