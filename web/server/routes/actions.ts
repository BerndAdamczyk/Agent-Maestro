/**
 * Action Routes.
 * Reference: arc42 Section 5.2.3
 * POST /api/actions/approve-plan, POST /api/actions/delegate, POST /api/actions/reconcile
 */

import { Router } from "express";
import type { TaskManager } from "../../../src/task-manager.js";
import type { Logger } from "../../../src/logger.js";

export function actionRoutes(taskManager: TaskManager, logger: Logger): Router {
  const router = Router();

  router.post("/approve-plan", (req, res) => {
    const { taskId } = req.body;
    if (!taskId) {
      res.status(400).json({ error: "taskId required" });
      return;
    }

    const task = taskManager.readTask(taskId);
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    if (task.status !== "plan_ready") {
      res.status(400).json({ error: `Task status is '${task.status}', expected 'plan_ready'` });
      return;
    }

    taskManager.updateStatus(taskId, "plan_approved");
    logger.logEntry("Developer", `Approved plan for ${taskId}`);
    res.json({ ok: true, task: taskManager.readTask(taskId) });
  });

  router.post("/revise-plan", (req, res) => {
    const { taskId, feedback } = req.body;
    if (!taskId || !feedback) {
      res.status(400).json({ error: "taskId and feedback required" });
      return;
    }

    const task = taskManager.readTask(taskId);
    if (!task) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    taskManager.setRevisionFeedback(taskId, feedback);
    taskManager.updateStatus(taskId, "plan_revision_needed");
    logger.logEntry("Developer", `Requested revision for ${taskId}: ${feedback}`);
    res.json({ ok: true });
  });

  return router;
}
