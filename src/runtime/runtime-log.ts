/**
 * Per-agent runtime log persistence.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { redactSecrets, stripUnsafeControlChars } from "../security.js";
import { appendLocked, formatTimestamp, slugify } from "../utils.js";

export function appendRuntimeObservation(
  workspaceRoot: string,
  agentName: string,
  message: string,
  context: { taskId?: string | null; correlationId?: string | null } = {},
): void {
  const logsDir = join(workspaceRoot, "logs");
  mkdirSync(logsDir, { recursive: true });

  const sanitized = stripUnsafeControlChars(redactSecrets(message)).trim();
  if (!sanitized) return;

  const prefixes = [
    context.taskId ? `task=${context.taskId}` : null,
    context.correlationId ? `corr=${context.correlationId}` : null,
  ].filter(Boolean);
  const prefix = prefixes.length > 0 ? `${prefixes.join(" ")} ` : "";

  const line = `[${formatTimestamp(new Date(), { includeMilliseconds: true })}] ${prefix}${sanitized}\n`;
  appendLocked(join(logsDir, `${slugify(agentName)}.log`), line);
}
