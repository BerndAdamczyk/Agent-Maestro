/**
 * Shared utilities.
 */

import { writeFileSync, renameSync } from "node:fs";

/**
 * Atomic file write via write-tmp-then-rename.
 * Prevents partial writes from corrupting state if a process crashes mid-write.
 * Reference: arc42 Section 8.11 (atomicWrite [target] -- implemented early as quick win)
 */
export function atomicWrite(filePath: string, content: string): void {
  const tmp = `${filePath}.tmp.${process.pid}`;
  writeFileSync(tmp, content, "utf-8");
  renameSync(tmp, filePath);
}

/**
 * Slugify a name for use as file/directory name.
 */
export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * Rough token estimation (~4 chars per token for English text).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Sanitize a string for safe shell execution.
 * Strips control characters that could be used for injection.
 */
export function sanitizeForShell(input: string): string {
  return input.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
}
