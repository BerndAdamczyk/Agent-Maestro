/**
 * Session DAG Manager - Level 1 Memory.
 * Reference: arc42 Section 5.2.2 (SessionDAGManager), 6.7 (Session DAG Branching)
 *
 * JSONL-based DAG for agent session context with branching and rewind.
 * Append-only for crash safety.
 */

import { appendFileSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { v4 as uuid } from "uuid";
import type { SessionDAGEntry } from "../types.js";

export class SessionDAGManager {
  private sessionsDir: string;
  private leafPointers = new Map<string, string>(); // taskId -> current leaf node ID

  constructor(memoryDir: string) {
    this.sessionsDir = join(memoryDir, "sessions");
    mkdirSync(this.sessionsDir, { recursive: true });
  }

  private sessionFile(taskId: string): string {
    return join(this.sessionsDir, `${taskId}.jsonl`);
  }

  createSession(taskId: string): void {
    const filePath = this.sessionFile(taskId);
    if (!existsSync(filePath)) {
      writeFileSync(filePath, "", "utf-8");
    }
  }

  append(taskId: string, entry: Omit<SessionDAGEntry, "id" | "ts">): SessionDAGEntry {
    const full: SessionDAGEntry = {
      ...entry,
      id: uuid(),
      ts: new Date().toISOString(),
    };

    const filePath = this.sessionFile(taskId);
    appendFileSync(filePath, JSON.stringify(full) + "\n", "utf-8");
    this.leafPointers.set(taskId, full.id);

    return full;
  }

  rewind(taskId: string, toNodeId: string): void {
    // Move the leaf pointer without deleting nodes (append-only principle)
    const entries = this.readAll(taskId);
    const exists = entries.some(e => e.id === toNodeId);
    if (!exists) {
      throw new Error(`Node '${toNodeId}' not found in session DAG for task '${taskId}'`);
    }
    this.leafPointers.set(taskId, toNodeId);
  }

  getLeaf(taskId: string): string | null {
    return this.leafPointers.get(taskId) ?? null;
  }

  readAll(taskId: string): SessionDAGEntry[] {
    const filePath = this.sessionFile(taskId);
    if (!existsSync(filePath)) return [];

    const content = readFileSync(filePath, "utf-8").trim();
    if (!content) return [];

    return content.split("\n").map(line => JSON.parse(line) as SessionDAGEntry);
  }

  getActiveBranch(taskId: string): SessionDAGEntry[] {
    const all = this.readAll(taskId);
    const leaf = this.getLeaf(taskId);
    if (!leaf) return all;

    // Walk back from leaf to root
    const byId = new Map(all.map(e => [e.id, e]));
    const branch: SessionDAGEntry[] = [];
    let current: string | null = leaf;

    while (current) {
      const entry = byId.get(current);
      if (!entry) break;
      branch.unshift(entry);
      current = entry.parentId;
    }

    return branch;
  }

  sessionExists(taskId: string): boolean {
    return existsSync(this.sessionFile(taskId));
  }
}
