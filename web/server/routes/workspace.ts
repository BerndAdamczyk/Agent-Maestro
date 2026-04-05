/**
 * Workspace Routes.
 * Reference: arc42 Section 5.2.3
 * GET /api/workspace/{goal,plan,status,log}
 */

import { Router } from "express";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseLogEntries } from "../../../src/logger.js";

export function workspaceRoutes(workspaceDir: string): Router {
  const router = Router();

  const readFile = (file: string) => {
    const p = join(workspaceDir, file);
    return existsSync(p) ? readFileSync(p, "utf-8") : "";
  };

  router.get("/goal", (_req, res) => {
    res.json({ content: readFile("goal.md") });
  });

  router.get("/plan", (_req, res) => {
    res.json({ content: readFile("plan.md") });
  });

  router.get("/status", (_req, res) => {
    res.json({ content: readFile("status.md") });
  });

  router.get("/log", (_req, res) => {
    const content = readFile("log.md");
    const entries = parseLogEntries(content);
    res.json({ content, entries });
  });

  return router;
}
