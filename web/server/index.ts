/**
 * Web Server - Express + WebSocket.
 * Reference: arc42 Section 5.2.3, 7 (Deployment View)
 *
 * REST API on port 3000, bound to 127.0.0.1 (localhost only).
 * WebSocket for real-time file change events and pane output streaming.
 */

import express from "express";
import { createServer } from "node:http";
import { join } from "node:path";
import type { SystemConfig, SessionState } from "../../src/types.js";
import type { TaskManager } from "../../src/task-manager.js";
import type { AgentResolver } from "../../src/config.js";
import type { Logger } from "../../src/logger.js";
import { FileWatcherService } from "./services/file-watcher.js";
import { TmuxService } from "./services/tmux-service.js";
import { WebSocketHandler } from "./ws/handler.js";
import { workspaceRoutes } from "./routes/workspace.js";
import { taskRoutes } from "./routes/tasks.js";
import { agentRoutes } from "./routes/agents.js";
import { configRoutes } from "./routes/config.js";
import { sessionRoutes } from "./routes/session.js";
import { skillRoutes } from "./routes/skills.js";
import { actionRoutes } from "./routes/actions.js";
import { tmuxRoutes } from "./routes/tmux.js";
import { memoryRoutes } from "./routes/memory.js";

export interface WebServerDeps {
  rootDir: string;
  config: SystemConfig;
  taskManager: TaskManager;
  agentResolver: AgentResolver;
  logger: Logger;
  getSession: () => SessionState | null;
}

export function createWebServer(deps: WebServerDeps) {
  const { rootDir, config, taskManager, agentResolver, logger, getSession } = deps;

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "256kb" }));
  app.use(createSecurityHeadersMiddleware());
  app.use(createLoopbackOnlyMiddleware());
  app.use(createMutationRateLimitMiddleware());
  const tmuxService = new TmuxService(config.tmux_session);

  // Static files for web client
  const clientDir = join(rootDir, "web", "client");
  app.use(express.static(clientDir));

  // API routes
  const workspaceDir = join(rootDir, config.paths.workspace);
  const skillsDir = join(rootDir, config.paths.skills);
  const memoryDir = join(rootDir, config.paths.memory);

  app.use("/api/workspace", workspaceRoutes(workspaceDir));
  app.use("/api/tasks", taskRoutes(taskManager));
  app.use("/api/agents", agentRoutes(agentResolver));
  app.use("/api/config", configRoutes(config));
  app.use("/api/session", sessionRoutes(getSession));
  app.use("/api/skills", skillRoutes(skillsDir));
  app.use("/api/actions", actionRoutes(taskManager, logger));
  app.use("/api/tmux", tmuxRoutes(tmuxService));
  app.use("/api/memory", memoryRoutes(memoryDir));

  // Health check
  app.get("/api/health", (_req, res) => {
    const panes = tmuxService.listPanes();
    res.json({
      status: "ok",
      uptime: process.uptime(),
      tmuxSessionExists: tmuxService.sessionExists(),
      paneCount: panes.length,
      unhealthyPaneCount: panes.filter(pane => !pane.healthy).length,
    });
  });

  // HTTP server
  const server = createServer(app);

  // WebSocket
  const wsHandler = new WebSocketHandler(server, tmuxService);

  // File watcher
  const fileWatcher = new FileWatcherService(rootDir);
  fileWatcher.onFileChange((event) => {
    wsHandler.broadcast(event);
  });

  return {
    app,
    server,
    wsHandler,
    fileWatcher,
    start(port: number = 3000, host: string = "127.0.0.1"): Promise<void> {
      return new Promise((resolve, reject) => {
        fileWatcher.start();
        const onError = (error: Error) => {
          server.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          server.off("error", onError);
          console.log(`Web server: http://${host}:${port}`);
          resolve();
        };

        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, host);
      });
    },
    stop(): Promise<void> {
      fileWatcher.stop();
      return new Promise((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

function createSecurityHeadersMiddleware() {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("Content-Security-Policy", [
      "default-src 'self'",
      "img-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline'",
      "connect-src 'self' ws: wss:",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
    ].join('; '));
    if (req.path.startsWith("/api/")) {
      res.setHeader("Cache-Control", "no-store");
    }
    next();
  };
}

function createLoopbackOnlyMiddleware() {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const remoteAddress = req.socket.remoteAddress ?? req.ip ?? "";
    if (isLoopbackAddress(remoteAddress)) {
      next();
      return;
    }

    res.status(403).json({ error: "Web UI is restricted to loopback clients." });
  };
}

function isLoopbackAddress(address: string): boolean {
  return address === "127.0.0.1"
    || address === "::1"
    || address === "::ffff:127.0.0.1"
    || address.startsWith("::ffff:127.");
}

function createMutationRateLimitMiddleware() {
  const mutationWindowMs = 60_000;
  const mutationLimit = 30;
  const requestTimes = new Map<string, number[]>();

  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      next();
      return;
    }

    const remoteAddress = req.socket.remoteAddress ?? req.ip ?? "unknown";
    const key = `${remoteAddress}:${req.method}`;
    const now = Date.now();
    const recent = (requestTimes.get(key) ?? []).filter(ts => now - ts < mutationWindowMs);
    if (recent.length >= mutationLimit) {
      res.status(429).json({ error: "Too many mutating requests. Please retry shortly." });
      return;
    }

    recent.push(now);
    requestTimes.set(key, recent);
    next();
  };
}
