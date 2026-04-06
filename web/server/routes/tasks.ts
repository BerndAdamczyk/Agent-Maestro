/**
 * Task Routes.
 * Reference: arc42 Section 5.2.3
 * GET /api/tasks, GET /api/tasks/:id, PUT /api/tasks/:id
 */

import { Router } from "express";
import type { TaskManager } from "../../../src/task-manager.js";
import type { TaskStatus } from "../../../src/types.js";

export function taskRoutes(taskManager: TaskManager): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    const tasks = taskManager.getAllTasks();
    res.json(tasks);
  });

  router.get("/:id", (req, res) => {
    const task = taskManager.readTask(req.params.id as string);
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    res.json(task);
  });

  router.put("/:id", (req, res) => {
    const task = taskManager.readTask(req.params.id as string);
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    if (req.body.status) {
      if (req.body.status === "complete") {
        const validation = taskManager.validateHandoff(req.params.id as string);
        if (validation.status === "invalid") {
          res.status(400).json({
            error: "Handoff report validation failed",
            validation,
          });
          return;
        }
      }

      taskManager.updateStatus(req.params.id as string, req.body.status as TaskStatus);
    }

    res.json(taskManager.readTask(req.params.id as string));
  });

  return router;
}
