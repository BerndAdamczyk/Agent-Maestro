/**
 * Daily Protocol Flusher - Level 2 Memory.
 * Reference: arc42 Section 5.2.2 (DailyProtocolFlusher), 6.8 (Silent Memory Flush)
 *
 * Delta-appends findings to YYYY-MM-DD.md files.
 * Triggered by pre_compaction lifecycle hook.
 */

import { appendFileSync, readFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { DailyProtocolEntry } from "../types.js";

export class DailyProtocolFlusher {
  private dailyDir: string;
  private retentionDays: number;

  constructor(memoryDir: string, retentionDays: number = 30) {
    this.dailyDir = join(memoryDir, "daily");
    this.retentionDays = retentionDays;
    mkdirSync(this.dailyDir, { recursive: true });
  }

  private todayFile(): string {
    const date = new Date().toISOString().slice(0, 10);
    return join(this.dailyDir, `${date}.md`);
  }

  private ensureHeader(filePath: string): void {
    if (!existsSync(filePath)) {
      const date = new Date().toISOString().slice(0, 10);
      const header = `# Daily Protocol: ${date}\n\n## Findings\n\n## Error Patterns\n\n## Decisions\n\n`;
      appendFileSync(filePath, header, "utf-8");
    }
  }

  flush(entries: DailyProtocolEntry[]): void {
    const filePath = this.todayFile();
    this.ensureHeader(filePath);

    const content = readFileSync(filePath, "utf-8");
    const lines: string[] = [];

    for (const entry of entries) {
      const bullet = `- [${entry.time}] (${entry.agent}, confidence: ${entry.confidence}) ${entry.content}${entry.sourceTask ? ` -- ${entry.sourceTask}` : ""}`;
      lines.push(bullet);
    }

    if (lines.length === 0) return;

    // Group by category and append to the right section
    const findings = entries.filter(e => e.category === "finding");
    const errors = entries.filter(e => e.category === "error_pattern");
    const decisions = entries.filter(e => e.category === "decision");

    let appended = "";

    if (findings.length > 0) {
      appended += this.formatEntries(findings);
    }
    if (errors.length > 0) {
      appended += this.formatEntries(errors);
    }
    if (decisions.length > 0) {
      appended += this.formatEntries(decisions);
    }

    // Append to end of file (delta-append, not rewrite)
    appendFileSync(filePath, appended, "utf-8");
  }

  private formatEntries(entries: DailyProtocolEntry[]): string {
    return entries
      .map(e => {
        const prefix = `- [${e.time}] (${e.agent}, confidence: ${e.confidence})`;
        const source = e.sourceTask ? ` _Source: ${e.sourceTask}_` : "";
        return `${prefix} ${e.content}${source}\n`;
      })
      .join("");
  }

  readToday(): string {
    const filePath = this.todayFile();
    if (!existsSync(filePath)) return "";
    return readFileSync(filePath, "utf-8");
  }

  readDate(date: string): string {
    const filePath = join(this.dailyDir, `${date}.md`);
    if (!existsSync(filePath)) return "";
    return readFileSync(filePath, "utf-8");
  }

  pruneOldProtocols(): number {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.retentionDays);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    let pruned = 0;

    if (!existsSync(this.dailyDir)) return 0;

    for (const file of readdirSync(this.dailyDir)) {
      if (!file.endsWith(".md")) continue;
      const dateStr = file.replace(".md", "");
      if (dateStr < cutoffStr) {
        unlinkSync(join(this.dailyDir, file));
        pruned++;
      }
    }

    return pruned;
  }
}
