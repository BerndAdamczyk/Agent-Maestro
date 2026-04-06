import test from "node:test";
import assert from "node:assert/strict";

import { OrchestrationEngine } from "../dist/src/orchestration-engine.js";

test("run fails immediately when a wave already contains failed tasks", async () => {
  const plan = {
    source: "workspace",
    sourcePath: "workspace/plan.md",
    goal: "ping",
    tasks: [
      {
        id: "task-001",
        title: "Acknowledge ping",
        description: "Respond to ping",
        assigned_to: "Product Manager",
        task_type: "general",
        dependencies: [],
        parent_task: null,
        plan_first: false,
        time_budget: 60,
        acceptance_criteria: [],
        wave: 1,
        originalOrder: 0,
      },
    ],
    validation_commands: [],
  };

  const engine = new OrchestrationEngine({
    rootDir: process.cwd(),
    config: {
      limits: {
        wave_timeout_seconds: 1,
        max_reconcile_retries: 0,
      },
      teams: [{ name: "Engineering", lead: { name: "Engineering Lead" } }],
      maestro: { name: "Maestro" },
    },
    session: {
      status: "active",
      currentWave: 0,
    },
    agentResolver: {
      getAgentHierarchyLevel: () => 1,
    },
    taskPlanService: {
      hasAuthoritativePlan: () => true,
      loadAuthoritativePlan: () => plan,
      materialize: () => [],
    },
    taskPlanProvider: {
      generate: () => {
        throw new Error("not used");
      },
    },
    taskManager: {
      readTask(taskId) {
        if (taskId !== "task-001") {
          return null;
        }

        return {
          id: taskId,
          status: "failed",
          assignedTo: "Product Manager",
          title: "Acknowledge ping",
          description: "Respond to ping",
          taskType: "general",
          acceptanceCriteria: [],
          phase: "none",
          wave: 1,
          dependencies: [],
          parentTask: null,
          planFirst: false,
          timeBudget: 60,
        };
      },
    },
    delegationEngine: {
      getActiveWorker: () => null,
      delegate: async () => {
        throw new Error("delegate should not be called");
      },
    },
    monitorEngine: {},
    reconcileEngine: {},
    statusManager: {
      refresh: () => {},
    },
    logger: {
      logEntry: () => {},
    },
    memory: {
      gitCheckpoint: {
        waveCheckpoint: () => {},
      },
    },
    runtime: {
      interrupt: () => {},
      hasCapacity: () => true,
    },
  });

  await assert.rejects(
    engine.run("ping"),
    /Wave 1 contains failed tasks: task-001/,
  );
});

test("reconciliation stops immediately when the fix task fails", async () => {
  const logEntries = [];
  const engine = new OrchestrationEngine({
    rootDir: process.cwd(),
    config: {
      limits: {
        wave_timeout_seconds: 1,
        max_reconcile_retries: 1,
      },
      teams: [{ name: "Engineering", lead: { name: "Engineering Lead" } }],
      maestro: { name: "Maestro" },
    },
    session: {
      status: "active",
      currentWave: 0,
    },
    agentResolver: {
      getAgentHierarchyLevel: () => 1,
    },
    taskPlanService: {
      hasAuthoritativePlan: () => true,
      loadAuthoritativePlan: () => {
        throw new Error("not used");
      },
      materialize: () => [],
    },
    taskPlanProvider: {
      generate: () => {
        throw new Error("not used");
      },
    },
    taskManager: {
      upsertTaskDefinition: () => {},
      readTask: () => null,
    },
    delegationEngine: {
      getActiveWorker: () => null,
      delegate: async () => {
        throw new Error("delegate should not be called");
      },
    },
    monitorEngine: {},
    reconcileEngine: {
      run: () => ({
        passed: false,
        stdout: "failing stdout",
        stderr: "failing stderr",
      }),
    },
    statusManager: {
      refresh: () => {},
    },
    logger: {
      logEntry: (...args) => {
        logEntries.push(args);
      },
    },
    memory: {
      gitCheckpoint: {
        waveCheckpoint: () => {},
      },
    },
    runtime: {
      interrupt: () => {},
      hasCapacity: () => true,
    },
  });

  engine.waitForTasks = async () => ({
    status: "failed",
    failedTaskIds: ["task-reconcile-1-1"],
  });

  const reconciled = await engine.runReconciliationLoop(1, ["npm test"]);

  assert.equal(reconciled, false);
  assert.deepEqual(logEntries.at(-1), [
    "Reconcile",
    "Reconciliation attempt 1 ended with status 'failed'",
    { level: "error", taskId: "task-reconcile-1-1" },
  ]);
});
