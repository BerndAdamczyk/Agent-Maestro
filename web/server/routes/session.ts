/**
 * Session Routes.
 * Reference: arc42 Section 5.2.3
 * GET /api/session/active, POST /api/session/start, POST /api/session/stop
 */

import { Router } from "express";
import type { SessionState } from "../../../src/types.js";

export function sessionRoutes(getSession: () => SessionState | null): Router {
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
    });
  });

  return router;
}
