/**
 * File Watcher Service.
 * Reference: arc42 Section 5.2.3 (FileWatcherService)
 *
 * Chokidar-based file monitoring. Classifies changes and emits typed events.
 */

import { watch, type FSWatcher } from "chokidar";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import type { FileChangeEvent, FileChangeType } from "../../../src/types.js";
import { redactSecrets, stripUnsafeControlChars } from "../../../src/security.js";

export type FileChangeHandler = (event: FileChangeEvent) => void;

export class FileWatcherService {
  private rootDir: string;
  private watcher: FSWatcher | null = null;
  private handlers: FileChangeHandler[] = [];

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  onFileChange(handler: FileChangeHandler): void {
    this.handlers.push(handler);
  }

  start(): void {
    const watchPaths = [
      `${this.rootDir}/workspace`,
      `${this.rootDir}/agents`,
      `${this.rootDir}/memory`,
      `${this.rootDir}/skills`,
      `${this.rootDir}/multi-team-config.yaml`,
    ];

    this.watcher = watch(watchPaths, {
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    });

    this.watcher.on("change", (filePath: string) => this.handleChange(filePath));
    this.watcher.on("add", (filePath: string) => this.handleChange(filePath));
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
  }

  private handleChange(filePath: string): void {
    const relPath = relative(this.rootDir, filePath);
    const type = classifyFile(relPath);

    let content = "";
    try {
      content = stripUnsafeControlChars(redactSecrets(readFileSync(filePath, "utf-8")));
    } catch {
      // File might have been deleted between event and read
    }

    const event: FileChangeEvent = {
      path: relPath,
      type,
      content,
      timestamp: new Date().toISOString(),
    };

    for (const handler of this.handlers) {
      handler(event);
    }
  }
}

export function classifyFile(relPath: string): FileChangeType {
  if (relPath.includes("workspace/goal.md")) return "goal";
  if (relPath.includes("workspace/plan.md")) return "plan";
  if (relPath.includes("workspace/status.md")) return "status";
  if (relPath.includes("workspace/log.md")) return "log";
  if (relPath.includes("workspace/tasks/")) return "task";
  if (relPath.includes("agents/")) return "agent";
  if (relPath.includes("memory/")) return "memory";
  if (relPath.includes("skills/")) return "skill";
  if (relPath.includes("multi-team-config.yaml")) return "config";
  return "config";
}
