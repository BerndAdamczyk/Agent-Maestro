/**
 * Tmux Routes.
 * Reference: arc42 Section 5.2.3
 * GET /api/tmux/panes, GET /api/tmux/panes/:id/output
 */

import { Router } from "express";
import type { TmuxService } from "../services/tmux-service.js";

export function tmuxRoutes(tmuxService: TmuxService): Router {
  const router = Router();

  router.get("/panes", (_req, res) => {
    const panes = tmuxService.listPanes();
    res.json(panes);
  });

  router.get("/panes/:id/output", (req, res) => {
    const output = tmuxService.capturePane(req.params.id as string);
    res.json({ paneId: req.params.id, content: output });
  });

  router.get("/session", (_req, res) => {
    res.json({ exists: tmuxService.sessionExists() });
  });

  return router;
}
