/**
 * Session Routes.
 * Reference: arc42 Section 5.2.3
 * GET /api/session/active, POST /api/session/start, POST /api/session/stop
 */

import { Router } from "express";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionState } from "../../../src/types.js";

export function sessionRoutes(getSession: () => SessionState | null, workspaceDir: string): Router {
  const router = Router();

  router.get("/active", (_req, res) => {
    const session = getSession();
    if (!session) {
      res.status(404).json({ error: "No active session" });
      return;
    }
    res.json({
      sessionId: session.sessionId,
      goal: session.goal,
      status: session.status,
      startedAt: session.startedAt,
      currentWave: session.currentWave,
      activeWorkerCount: session.activeWorkers.size,
      executionIntentSummary: readExecutionIntentSummary(workspaceDir),
    });
  });

  return router;
}

function readExecutionIntentSummary(workspaceDir: string) {
  const queuePath = join(workspaceDir, "runtime-state", "execution-intents.json");
  if (!existsSync(queuePath)) {
    return {
      total: 0,
      pending: 0,
      inProgress: 0,
      completed: 0,
      skipped: 0,
      failed: 0,
    };
  }

  try {
    const intents = JSON.parse(readFileSync(queuePath, "utf-8")) as Array<{ status?: string }>;
    return intents.reduce((summary, intent) => {
      summary.total += 1;
      switch (intent.status) {
        case "pending":
          summary.pending += 1;
          break;
        case "in_progress":
          summary.inProgress += 1;
          break;
        case "completed":
          summary.completed += 1;
          break;
        case "skipped":
          summary.skipped += 1;
          break;
        case "failed":
          summary.failed += 1;
          break;
        default:
          break;
      }
      return summary;
    }, {
      total: 0,
      pending: 0,
      inProgress: 0,
      completed: 0,
      skipped: 0,
      failed: 0,
    });
  } catch {
    return {
      total: 0,
      pending: 0,
      inProgress: 0,
      completed: 0,
      skipped: 0,
      failed: 0,
    };
  }
}
