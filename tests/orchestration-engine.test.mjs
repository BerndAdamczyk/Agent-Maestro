import test from "node:test";
import assert from "node:assert/strict";

import { OrchestrationEngine } from "../dist/src/orchestration-engine.js";

test("run fails when a wave has failed tasks and remediation retries are exhausted", async () => {
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
          handoffReport: null,
          handoffValidation: null,
          revisionFeedback: null,
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
    /Wave 1 pre-existing failures could not be remediated: task-001/,
  );
});

test("run remediates failed wave tasks when actionable findings exist", async () => {
  let taskStatus = "failed";
  let fixTaskCreated = false;
  let fixTaskStatus = "pending";
  let statusResetCount = 0;

  const plan = {
    source: "workspace",
    sourcePath: "workspace/plan.md",
    goal: "fix things",
    tasks: [
      {
        id: "task-001",
        title: "Security review",
        description: "Review security",
        assigned_to: "Security Reviewer",
        task_type: "review",
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
        wave_timeout_seconds: 5,
        max_reconcile_retries: 2,
        task_timeout_seconds: 60,
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
      findAgentByName: () => null,
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
        if (taskId === "task-001") {
          return {
            id: taskId,
            status: taskStatus,
            assignedTo: "Security Reviewer",
            title: "Security review",
            description: "Review security",
            taskType: "review",
            acceptanceCriteria: [],
            phase: "none",
            wave: 1,
            dependencies: [],
            parentTask: null,
            planFirst: false,
            timeBudget: 60,
            handoffReport: {
              changesMade: "Reviewed code",
              patternsFollowed: "Standard review",
              unresolvedConcerns: "Bash enforcement is regex-based and bypassable",
              suggestedFollowups: "Fix policy extension",
            },
            handoffValidation: null,
            revisionFeedback: null,
          };
        }
        if (taskId.startsWith("task-fix-")) {
          return fixTaskCreated
            ? {
                id: taskId,
                status: fixTaskStatus,
                assignedTo: "Engineering Lead",
                title: "Fix",
                description: "Fix it",
                taskType: "implementation",
                acceptanceCriteria: [],
                phase: "none",
                wave: 1,
                dependencies: [],
                parentTask: null,
                planFirst: false,
                timeBudget: 60,
                handoffReport: null,
                handoffValidation: { status: "valid" },
                revisionFeedback: null,
              }
            : null;
        }
        return null;
      },
      upsertTaskDefinition(params) {
        fixTaskCreated = true;
        return { id: params.taskId };
      },
      updateStatus(taskId, status) {
        if (taskId === "task-001" && status === "pending") {
          statusResetCount++;
          taskStatus = "complete";
        }
      },
    },
    delegationEngine: {
      getActiveWorker: () => null,
      delegate: async () => ({}),
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

  // Stub waitForTasks to simulate fix tasks completing and retry succeeding
  const originalWait = engine.waitForTasks.bind(engine);
  let waitCallCount = 0;
  engine.waitForTasks = async (taskIds, timeout, label) => {
    waitCallCount++;
    if (label.includes("remediation")) {
      fixTaskStatus = "complete";
      return { status: "complete", failedTaskIds: [] };
    }
    if (label.includes("retry")) {
      return { status: "complete", failedTaskIds: [] };
    }
    // Original wave run — task-001 fails
    return { status: "failed", failedTaskIds: ["task-001"] };
  };

  await engine.run("fix things");

  assert.ok(fixTaskCreated, "should have created a fix task");
  assert.ok(statusResetCount >= 1, "should have reset task-001 to pending at least once");
  assert.ok(waitCallCount >= 2, "should have called waitForTasks for fix tasks and retry");
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
