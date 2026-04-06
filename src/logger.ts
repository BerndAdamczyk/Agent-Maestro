/**
 * Logger - Activity logging to workspace/log.md.
 * Reference: arc42 Section 5.2.1 (Logger), 8.16 (Logging and Audit Trail)
 *
 * Appends markdown table rows plus a JSONL sidecar. Append-only for concurrent safety.
 */

import { appendFileSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { LogEntry, LogLevel } from "./types.js";
import { redactSecrets, stripUnsafeControlChars } from "./security.js";

const LOG_HEADER = `# Activity Log

| Timestamp | Level | Task ID | Correlation ID | Agent | Message |
|-----------|-------|---------|----------------|-------|---------|
`;

export interface LogContext {
  level?: LogLevel;
  taskId?: string | null;
  correlationId?: string | null;
}

export class Logger {
  private logPath: string;
  private jsonlPath: string;

  constructor(workspaceDir: string) {
    this.logPath = join(workspaceDir, "log.md");
    this.jsonlPath = join(workspaceDir, "log.jsonl");
  }

  initialize(): void {
    if (!existsSync(this.logPath)) {
      writeFileSync(this.logPath, LOG_HEADER, "utf-8");
    }
    if (!existsSync(this.jsonlPath)) {
      writeFileSync(this.jsonlPath, "", "utf-8");
    }
  }

  logEntry(agent: string, message: string, context: LogContext = {}): void {
    const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
    const entry: LogEntry = {
      timestamp: ts,
      level: context.level ?? "info",
      taskId: context.taskId ?? null,
      correlationId: context.correlationId ?? null,
      agent: this.formatCell(agent),
      message: this.formatCell(message),
    };

    const row = [
      "|",
      entry.timestamp,
      "|",
      this.formatCell(entry.level),
      "|",
      this.formatCell(entry.taskId ?? "-"),
      "|",
      this.formatCell(entry.correlationId ?? "-"),
      "|",
      entry.agent,
      "|",
      entry.message,
      "|",
    ].join(" ") + "\n";

    appendFileSync(this.logPath, row, "utf-8");
    appendFileSync(this.jsonlPath, JSON.stringify(entry) + "\n", "utf-8");
  }

  readAll(): LogEntry[] {
    if (!existsSync(this.logPath)) return [];
    const content = readFileSync(this.logPath, "utf-8");
    return parseLogEntries(content);
  }

  private formatCell(input: string): string {
    return stripUnsafeControlChars(redactSecrets(input))
      .replace(/\n+/g, " ")
      .replace(/\s+/g, " ")
      .replace(/\|/g, "/")
      .trim();
  }
}

export function parseLogEntries(content: string): LogEntry[] {
  const lines = content.split("\n");
  const entries: LogEntry[] = [];

  for (const line of lines) {
    const parts = line
      .split("|")
      .slice(1, -1)
      .map(part => part.trim());

    if (parts.length !== 3 && parts.length !== 6) continue;

    if (parts[0] === "Timestamp" || parts[0]?.startsWith("---")) continue;

    if (parts.length === 3) {
      entries.push({
        timestamp: parts[0]!,
        level: "info",
        taskId: null,
        correlationId: null,
        agent: parts[1]!,
        message: parts[2]!,
      });
      continue;
    }

    entries.push({
      timestamp: parts[0]!,
      level: normalizeLevel(parts[1]),
      taskId: normalizeNullable(parts[2]),
      correlationId: normalizeNullable(parts[3]),
      agent: parts[4]!,
      message: parts[5]!,
    });
  }

  return entries;
}

function normalizeNullable(value: string | undefined): string | null {
  if (!value || value === "-") return null;
  return value;
}

function normalizeLevel(value: string | undefined): LogLevel {
  switch (value) {
    case "debug":
    case "info":
    case "warn":
    case "error":
      return value;
    default:
      return "info";
  }
}
