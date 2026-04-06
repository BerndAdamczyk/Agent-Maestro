/**
 * WebSocket Handler.
 * Reference: arc42 Section 5.2.3 (WSHandler), 6.4 (Real-time UI Updates)
 *
 * Broadcasts file change events to connected clients.
 * Supports pane output subscriptions with 2.5s polling.
 */

import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";
import type { FileChangeEvent } from "../../../src/types.js";
import { formatTimestamp } from "../../../src/utils.js";
import { parseLogEntries } from "../../../src/logger.js";
import type { TmuxService } from "../services/tmux-service.js";

interface PaneSubscription {
  paneId: string;
  interval: ReturnType<typeof setInterval>;
}

export class WebSocketHandler {
  private wss: WebSocketServer;
  private tmuxService: TmuxService;
  private paneSubscriptions = new Map<WebSocket, PaneSubscription[]>();

  constructor(server: Server, tmuxService: TmuxService) {
    this.tmuxService = tmuxService;
    this.wss = new WebSocketServer({ server });
    this.wss.on("error", () => {
      // Startup/listen errors are surfaced by the HTTP server promise path.
    });

    this.wss.on("connection", (ws) => {
      this.paneSubscriptions.set(ws, []);

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleMessage(ws, msg);
        } catch {
          // Ignore malformed messages
        }
      });

      ws.on("close", () => {
        this.cleanupSubscriptions(ws);
        this.paneSubscriptions.delete(ws);
      });
    });
  }

  /**
   * Broadcast a file change event to all connected clients.
   */
  broadcast(event: FileChangeEvent): void {
    const msg = serializeFileChangeEvent(event);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }

  /**
   * Broadcast a log entry event.
   */
  broadcastLog(agent: string, message: string): void {
    const msg = JSON.stringify({
      type: "log:entry",
      agent,
      message,
      timestamp: formatTimestamp(),
    });
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }

  private handleMessage(ws: WebSocket, msg: any): void {
    if (msg.type === "subscribe:pane" && msg.paneId) {
      this.subscribeToPaneOutput(ws, msg.paneId);
    } else if (msg.type === "unsubscribe:pane" && msg.paneId) {
      this.unsubscribeFromPane(ws, msg.paneId);
    }
  }

  private subscribeToPaneOutput(ws: WebSocket, paneId: string): void {
    const subs = this.paneSubscriptions.get(ws);
    if (!subs) return;

    // Don't double-subscribe
    if (subs.some(s => s.paneId === paneId)) return;

    const interval = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        clearInterval(interval);
        return;
      }

      const content = this.tmuxService.capturePane(paneId);
      ws.send(JSON.stringify({
        type: "pane:output",
        paneId,
        content,
      }));
    }, 2500); // 2.5s polling per arc42

    subs.push({ paneId, interval });
  }

  private unsubscribeFromPane(ws: WebSocket, paneId: string): void {
    const subs = this.paneSubscriptions.get(ws);
    if (!subs) return;

    const idx = subs.findIndex(s => s.paneId === paneId);
    if (idx >= 0) {
      clearInterval(subs[idx]!.interval);
      subs.splice(idx, 1);
    }
  }

  private cleanupSubscriptions(ws: WebSocket): void {
    const subs = this.paneSubscriptions.get(ws);
    if (!subs) return;
    for (const sub of subs) {
      clearInterval(sub.interval);
    }
  }

  getClientCount(): number {
    return this.wss.clients.size;
  }
}

export function serializeFileChangeEvent(event: FileChangeEvent): string {
  return JSON.stringify({
    type: "file:changed",
    fileType: event.type,
    path: event.path,
    content: event.content,
    timestamp: event.timestamp,
    parsed: buildParsedPayload(event),
  });
}

function buildParsedPayload(event: FileChangeEvent): Record<string, unknown> | null {
  switch (event.type) {
    case "task":
      return {
        task: parseTaskSnapshot(event.path, event.content),
      };
    case "log": {
      const entries = parseLogEntries(event.content);
      return {
        lastEntry: entries.length > 0 ? entries[entries.length - 1] : null,
        totalEntries: entries.length,
      };
    }
    case "status":
      return {
        summary: parseStatusSummary(event.content),
      };
    case "goal":
      return {
        preview: event.content.trim().slice(0, 240),
      };
    case "memory":
      return {
        preview: event.content.trim().slice(0, 240),
      };
    default:
      return null;
  }
}

function parseTaskSnapshot(path: string, content: string): Record<string, unknown> | null {
  const taskIdMatch = path.match(/workspace\/tasks\/(.+)\.md$/);
  const taskId = taskIdMatch?.[1];
  if (!taskId) return null;

  const getField = (label: string): string => {
    const match = content.match(new RegExp(`\\*\\*${label}:\\*\\*\\s*(.+)`, "m"));
    return match?.[1]?.trim() ?? "";
  };

  const getSection = (heading: string): string => {
    const match = content.match(new RegExp(`## ${heading}\\n\\n([\\s\\S]*?)(?=\\n## |$)`, "m"));
    return match?.[1]?.trim() ?? "";
  };

  const getListSection = (heading: string): string[] => {
    return getSection(heading)
      .split("\n")
      .map(line => line.replace(/^- /, "").trim())
      .filter(Boolean);
  };

  const titleMatch = content.match(/^# .+?:\s*(.+)$/m);
  const dependencies = getField("Dependencies");
  const writeScope = getField("Write Scope");

  return {
    id: taskId,
    correlationId: getField("Correlation ID") || taskId,
    title: titleMatch?.[1] ?? "",
    description: getSection("Description"),
    assignedTo: getField("Assigned To"),
    taskType: getField("Task Type") || "general",
    acceptanceCriteria: getListSection("Acceptance Criteria"),
    writeScope: writeScope === "none" || !writeScope ? [] : writeScope.split(",").map(entry => entry.trim()).filter(Boolean),
    status: getField("Status") || "pending",
    phase: getField("Phase") || "none",
    wave: Number.parseInt(getField("Wave") || "0", 10),
    dependencies: dependencies === "none" || !dependencies ? [] : dependencies.split(",").map(entry => entry.trim()).filter(Boolean),
    parentTask: getField("Parent Task") === "none" ? null : getField("Parent Task") || null,
    planFirst: getField("Plan First") === "true",
    timeBudget: Number.parseInt(getField("Time Budget") || "600", 10),
    createdAt: getField("Created") || eventTimestampFallback(),
    updatedAt: getField("Updated") || eventTimestampFallback(),
    proposedApproach: getSection("Proposed Approach") || null,
    revisionFeedback: getSection("Revision Feedback") || null,
    handoffReport: parseHandoffReport(content),
  };
}

function parseHandoffReport(content: string): Record<string, string> | null {
  if (!/^## (?:Handoff Report|Handoff|Output)\s*$/m.test(content)) return null;
  const getSubSection = (heading: string): string => {
    const match = content.match(new RegExp(`### ${heading}\\n([\\s\\S]*?)(?=\\n### |\\n## |$)`, "m"));
    return match?.[1]?.trim() ?? "";
  };

  return {
    changesMade: getSubSection("Changes Made"),
    patternsFollowed: getSubSection("Patterns Followed"),
    unresolvedConcerns: getSubSection("Unresolved Concerns"),
    suggestedFollowups: getSubSection("Suggested Follow-ups"),
  };
}

function parseStatusSummary(content: string): Record<string, unknown> {
  const rows = [...content.matchAll(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/gm)];
  const taskRows = rows
    .map(match => ({
      taskId: match[1]?.trim() ?? "",
      title: match[2]?.trim() ?? "",
      assignedTo: match[3]?.trim() ?? "",
      wave: match[4]?.trim() ?? "",
      status: match[5]?.trim() ?? "",
      phase: match[6]?.trim() ?? "",
    }))
    .filter(row => row.taskId && row.taskId !== "Task" && !/^[-:]+$/.test(row.taskId));

  const counts = taskRows.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, {});

  return {
    taskCount: taskRows.length,
    counts,
    tasks: taskRows.slice(0, 12),
  };
}

function eventTimestampFallback(): string {
  return formatTimestamp();
}
