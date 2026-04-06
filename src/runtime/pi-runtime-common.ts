/**
 * Shared helpers for Pi-backed runtimes.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeResult } from "../types.js";
import { atomicWrite } from "../utils.js";

export function finalizeRuntimeResult(
  result: RuntimeResult,
  exitStatus: RuntimeResult["exitStatus"],
): RuntimeResult {
  const finishedAt = new Date().toISOString();
  const startedAt = result.metrics.startedAt;

  return {
    ...result,
    exitStatus,
    metrics: {
      ...result.metrics,
      finishedAt,
      durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
    },
  };
}

export function splitLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(Boolean);
}

export function writeTurnMessage(
  turnsDir: string,
  taskId: string,
  turnNumber: number,
  phase: string,
  message: string,
): string {
  mkdirSync(turnsDir, { recursive: true });
  const filePath = join(turnsDir, `${taskId}-turn-${String(turnNumber).padStart(3, "0")}.md`);
  atomicWrite(filePath, [
    `# Task Turn ${turnNumber}`,
    "",
    `**Phase:** ${phase}`,
    "",
    message.trim(),
    "",
  ].join("\n"));
  return filePath;
}
