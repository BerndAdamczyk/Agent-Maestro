/**
 * Per-task git worktree provisioning for mutating execution lanes.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { SystemConfig } from "./types.js";
import { atomicWrite, formatTimestamp, slugify } from "./utils.js";

export interface WorktreeAllocation {
  rootDir: string;
  isolated: boolean;
  metadata: WorktreeMetadata | null;
}

export interface WorktreeMetadata {
  schema_version: 1;
  taskId: string;
  path: string;
  branchRef: string;
  status: "active" | "parked";
  createdAt: string;
  updatedAt: string;
}

type TaskOutcome = "complete" | "failed" | "interrupted";

export class WorktreeManager {
  private rootDir: string;
  private config: SystemConfig;
  private metadataDir: string;
  private worktreeBaseDir: string;

  constructor(rootDir: string, config: SystemConfig) {
    this.rootDir = rootDir;
    this.config = config;
    this.metadataDir = join(rootDir, config.paths.workspace, "runtime-state", "worktrees");
    this.worktreeBaseDir = join(dirname(rootDir), `${basename(rootDir)}.worktrees`);
    mkdirSync(this.metadataDir, { recursive: true });
    mkdirSync(this.worktreeBaseDir, { recursive: true });
  }

  allocate(taskId: string, writeScope: string[]): WorktreeAllocation {
    if (!this.shouldIsolate(writeScope) || !this.isSupportedRuntimeMode() || !this.isGitRepo()) {
      return { rootDir: this.rootDir, isolated: false, metadata: null };
    }

    const existing = this.readMetadata(taskId);
    if (existing && existsSync(existing.path)) {
      const updated = this.writeMetadata({
        ...existing,
        status: "active",
        updatedAt: formatTimestamp(new Date(), { includeMilliseconds: true }),
      });
      return { rootDir: updated.path, isolated: true, metadata: updated };
    }

    const worktreePath = join(this.worktreeBaseDir, slugify(taskId));
    mkdirSync(this.worktreeBaseDir, { recursive: true });
    if (!existsSync(worktreePath)) {
      this.execGit(["worktree", "add", "--detach", worktreePath, "HEAD"]);
    }

    const now = formatTimestamp(new Date(), { includeMilliseconds: true });
    const metadata = this.writeMetadata({
      schema_version: 1,
      taskId,
      path: worktreePath,
      branchRef: this.execGit(["rev-parse", "HEAD"]),
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    return { rootDir: metadata.path, isolated: true, metadata };
  }

  finalize(taskId: string, outcome: TaskOutcome): void {
    const metadata = this.readMetadata(taskId);
    if (!metadata) return;

    if (outcome === "complete") {
      try {
        this.execGit(["worktree", "remove", "--force", metadata.path]);
      } finally {
        rmSync(this.metadataPath(taskId), { force: true });
      }
      return;
    }

    this.writeMetadata({
      ...metadata,
      status: "parked",
      updatedAt: formatTimestamp(new Date(), { includeMilliseconds: true }),
    });
  }

  readMetadata(taskId: string): WorktreeMetadata | null {
    const filePath = this.metadataPath(taskId);
    if (!existsSync(filePath)) return null;
    try {
      return JSON.parse(readFileSync(filePath, "utf-8")) as WorktreeMetadata;
    } catch {
      return null;
    }
  }

  shouldIsolate(writeScope: string[]): boolean {
    return writeScope.some(scope => {
      const normalized = scope.trim().replace(/\\/g, "/");
      return normalized !== "" && !normalized.startsWith("workspace/");
    });
  }

  private isSupportedRuntimeMode(): boolean {
    const mode = (process.env["MAESTRO_RUNTIME"] || "auto").toLowerCase();
    return mode !== "container" && mode !== "hybrid";
  }

  private isGitRepo(): boolean {
    try {
      this.execGit(["rev-parse", "--is-inside-work-tree"]);
      return true;
    } catch {
      return false;
    }
  }

  private writeMetadata(metadata: WorktreeMetadata): WorktreeMetadata {
    atomicWrite(this.metadataPath(metadata.taskId), JSON.stringify(metadata, null, 2));
    return metadata;
  }

  private metadataPath(taskId: string): string {
    return join(this.metadataDir, `${taskId}.json`);
  }

  private execGit(args: string[]): string {
    return execFileSync("git", args, {
      cwd: this.rootDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  }
}
