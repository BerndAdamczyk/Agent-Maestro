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
  app.use(express.json());

  // Static files for web client
  const clientDir = join(rootDir, "web", "client");
  app.use(express.static(clientDir));

  // API routes
  const workspaceDir = join(rootDir, config.paths.workspace);
  const skillsDir = join(rootDir, config.paths.skills);

  app.use("/api/workspace", workspaceRoutes(workspaceDir));
  app.use("/api/tasks", taskRoutes(taskManager));
  app.use("/api/agents", agentRoutes(agentResolver));
  app.use("/api/config", configRoutes(config));
  app.use("/api/session", sessionRoutes(getSession));
  app.use("/api/skills", skillRoutes(skillsDir));
  app.use("/api/actions", actionRoutes(taskManager, logger));
  app.use("/api/tmux", tmuxRoutes(new TmuxService(config.tmux_session)));

  // Health check
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", uptime: process.uptime() });
  });

  // HTTP server
  const server = createServer(app);

  // WebSocket
  const tmuxService = new TmuxService(config.tmux_session);
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
      return new Promise((resolve) => {
        fileWatcher.start();
        server.listen(port, host, () => {
          console.log(`Web server: http://${host}:${port}`);
          resolve();
        });
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
