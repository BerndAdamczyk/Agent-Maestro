/**
 * Logger - Activity logging to workspace/log.md.
 * Reference: arc42 Section 5.2.1 (Logger), 8.16 (Logging and Audit Trail)
 *
 * Appends markdown table rows. Append-only for concurrent safety.
 */

import { appendFileSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { LogEntry } from "./types.js";

const LOG_HEADER = `# Activity Log

| Timestamp | Agent | Message |
|-----------|-------|---------|
`;

export class Logger {
  private logPath: string;

  constructor(workspaceDir: string) {
    this.logPath = join(workspaceDir, "log.md");
  }

  initialize(): void {
    if (!existsSync(this.logPath)) {
      writeFileSync(this.logPath, LOG_HEADER, "utf-8");
    }
  }

  logEntry(agent: string, message: string): void {
    const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
    const row = `| ${ts} | ${agent} | ${message} |\n`;
    appendFileSync(this.logPath, row, "utf-8");
  }

  readAll(): LogEntry[] {
    if (!existsSync(this.logPath)) return [];
    const content = readFileSync(this.logPath, "utf-8");
    return parseLogEntries(content);
  }
}

export function parseLogEntries(content: string): LogEntry[] {
  const lines = content.split("\n");
  const entries: LogEntry[] = [];

  for (const line of lines) {
    const match = line.match(/^\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|$/);
    if (!match) continue;
    // Skip header rows
    if (match[1] === "Timestamp" || match[1]!.startsWith("---")) continue;

    entries.push({
      timestamp: match[1]!.trim(),
      agent: match[2]!.trim(),
      message: match[3]!.trim(),
    });
  }

  return entries;
}
