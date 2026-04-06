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

export function upsertMarkdownSection(content: string, heading: string, entryBlock: string): string {
  const normalizedEntry = entryBlock.trimEnd();
  const sectionRe = new RegExp(`(^## ${escapeRegExp(heading)}\\n)([\\s\\S]*?)(?=\\n## |$)`, "m");
  const match = content.match(sectionRe);

  if (!match || match.index === undefined) {
    const base = content.trimEnd();
    return `${base}\n\n## ${heading}\n\n${normalizedEntry}\n`;
  }

  const sectionStart = match.index;
  const fullMatch = match[0];
  const header = match[1] ?? `## ${heading}\n`;
  const body = (match[2] ?? "").trimEnd();
  const replacement = `${header}\n${body ? `${body}\n` : ""}${normalizedEntry}\n`;
  return `${content.slice(0, sectionStart)}${replacement}${content.slice(sectionStart + fullMatch.length)}`;
}

export function setMarkdownFrontmatterValue(content: string, key: string, value: string): string {
  const frontmatterRe = /^---\n([\s\S]*?)\n---\n?/;
  const match = content.match(frontmatterRe);
  if (!match) return content;

  const frontmatter = match[1] ?? "";
  const entryRe = new RegExp(`^${escapeRegExp(key)}:\s*.*$`, "m");
  const serializedValue = /^(?:"|\[|\{|\d|true|false|null)/.test(value) ? value : JSON.stringify(value);
  const nextFrontmatter = entryRe.test(frontmatter)
    ? frontmatter.replace(entryRe, `${key}: ${serializedValue}`)
    : `${frontmatter}\n${key}: ${serializedValue}`;

  return content.replace(frontmatterRe, `---\n${nextFrontmatter}\n---\n`);
}

export function formatTimestamp(
  date: Date = new Date(),
  options: { includeMilliseconds?: boolean } = {},
): string {
  const includeMilliseconds = options.includeMilliseconds ?? false;
  const year = date.getFullYear();
  const month = padNumber(date.getMonth() + 1);
  const day = padNumber(date.getDate());
  const hours = padNumber(date.getHours());
  const minutes = padNumber(date.getMinutes());
  const seconds = padNumber(date.getSeconds());
  const milliseconds = includeMilliseconds ? `.${padNumber(date.getMilliseconds(), 3)}` : "";

  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffsetMinutes = Math.abs(offsetMinutes);
  const offsetHours = padNumber(Math.floor(absoluteOffsetMinutes / 60));
  const offsetRemainderMinutes = padNumber(absoluteOffsetMinutes % 60);

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${milliseconds}${sign}${offsetHours}:${offsetRemainderMinutes}`;
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

function padNumber(value: number, width: number = 2): string {
  return String(value).padStart(width, "0");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
