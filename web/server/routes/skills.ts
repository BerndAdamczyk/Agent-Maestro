/**
 * Skills Routes.
 * Reference: arc42 Section 5.2.3
 * GET /api/skills
 */

import { Router } from "express";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export function skillRoutes(skillsDir: string): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    if (!existsSync(skillsDir)) {
      res.json([]);
      return;
    }

    const skills = readdirSync(skillsDir)
      .filter(f => f.endsWith(".md"))
      .map(f => ({
        name: f.replace(".md", ""),
        file: `skills/${f}`,
        content: readFileSync(join(skillsDir, f), "utf-8"),
      }));

    res.json(skills);
  });

  return router;
}
