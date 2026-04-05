/**
 * Git Checkpoint Engine.
 * Reference: arc42 Section 5.2.2 (GitCheckpointEngine), 8.17 (Git-Memory Integration)
 *
 * Automated commits with mem: prefix, branch-per-worker isolation,
 * merge-on-completion.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export class GitCheckpointEngine {
  private rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  private exec(cmd: string): string {
    try {
      return execSync(cmd, {
        cwd: this.rootDir,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 10000,
      }).trim();
    } catch (err: any) {
      throw new Error(`Git command failed: ${cmd}\n${err.stderr || err.message}`);
    }
  }

  isGitRepo(): boolean {
    try {
      this.exec("git rev-parse --is-inside-work-tree");
      return true;
    } catch {
      return false;
    }
  }

  ensureGitRepo(): void {
    if (!this.isGitRepo()) {
      this.exec("git init");
      // Initial commit if empty
      try {
        this.exec("git log -1");
      } catch {
        this.exec("git add -A && git commit -m 'Initial commit' --allow-empty");
      }
    }
  }

  getCurrentBranch(): string {
    return this.exec("git branch --show-current");
  }

  /**
   * Create a memory checkpoint commit.
   * Uses the mem: prefix convention for filterability.
   */
  checkpoint(message: string): string {
    // Stage memory files
    this.exec("git add memory/");

    // Check if there are staged changes
    try {
      this.exec("git diff --cached --quiet");
      return ""; // No changes to commit
    } catch {
      // There are changes, commit them
    }

    const fullMessage = `mem: ${message}`;
    this.exec(`git commit -m ${JSON.stringify(fullMessage)}`);
    return this.exec("git rev-parse HEAD");
  }

  /**
   * Create a worker branch for isolated memory operations.
   */
  createWorkerBranch(taskId: string): string {
    const branchName = `worker/${taskId}`;
    const currentBranch = this.getCurrentBranch();

    try {
      this.exec(`git checkout -b ${branchName}`);
    } catch {
      // Branch might already exist
      this.exec(`git checkout ${branchName}`);
    }

    return branchName;
  }

  /**
   * Merge a worker branch back to the main branch.
   */
  mergeWorkerBranch(taskId: string): void {
    const branchName = `worker/${taskId}`;
    const mainBranch = "main";

    this.exec(`git checkout ${mainBranch}`);

    try {
      this.exec(`git merge ${branchName} --no-edit`);
    } catch (err) {
      // On conflict, prefer the worker's changes for memory files
      this.exec(`git checkout --theirs memory/`);
      this.exec(`git add memory/`);
      this.exec(`git commit --no-edit`);
    }

    // Clean up the worker branch
    this.exec(`git branch -d ${branchName}`);
  }

  /**
   * Get memory change log via conventional mem: prefix.
   */
  getMemoryLog(count: number = 20): string {
    try {
      return this.exec(`git log --oneline --grep="^mem:" -n ${count}`);
    } catch {
      return "";
    }
  }

  /**
   * Stage and commit workspace state at wave boundaries.
   */
  waveCheckpoint(waveNumber: number): string {
    this.exec("git add workspace/ memory/");

    try {
      this.exec("git diff --cached --quiet");
      return "";
    } catch {
      // Has changes
    }

    const message = `wave-${waveNumber}: checkpoint`;
    this.exec(`git commit -m ${JSON.stringify(message)}`);
    return this.exec("git rev-parse HEAD");
  }
}
