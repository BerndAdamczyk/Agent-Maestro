/**
 * Per-agent runtime log persistence.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { redactSecrets, stripUnsafeControlChars } from "../security.js";
import { formatTimestamp, slugify } from "../utils.js";

export function appendRuntimeObservation(workspaceRoot: string, agentName: string, message: string): void {
  const logsDir = join(workspaceRoot, "logs");
  mkdirSync(logsDir, { recursive: true });

  const sanitized = stripUnsafeControlChars(redactSecrets(message)).trim();
  if (!sanitized) return;

  const line = `[${formatTimestamp(new Date(), { includeMilliseconds: true })}] ${sanitized}\n`;
  appendFileSync(join(logsDir, `${slugify(agentName)}.log`), line, "utf-8");
}
