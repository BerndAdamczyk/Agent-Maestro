/**
 * Config Routes.
 * Reference: arc42 Section 5.2.3
 * GET /api/config
 */

import { Router } from "express";
import type { SystemConfig } from "../../../src/types.js";

export function configRoutes(config: SystemConfig): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(config);
  });

  return router;
}
