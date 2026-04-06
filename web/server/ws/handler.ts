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
  });
}
