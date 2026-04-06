import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DelegationEngine } from "../dist/src/delegation-engine.js";

test("DelegationEngine launches workers with the configured model-tier policy and persists correlation metadata", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-maestro-delegation-"));
  mkdirSync(join(rootDir, "workspace", "tasks"), { recursive: true });
  mkdirSync(join(rootDir, "workspace", "runtime-policies"), { recursive: true });
  mkdirSync(join(rootDir, "workspace", "runtime-state"), { recursive: true });
  mkdirSync(join(rootDir, "workspace", "runtime-sessions"), { recursive: true });
  mkdirSync(join(rootDir, "memory", "sessions"), { recursive: true });

  const config = {
    paths: {
      workspace: "workspace",
      memory: "memory",
    },
    limits: {
      max_delegation_depth: 5,
    },
    model_tier_policy: {
      curator: { primary: "openai-codex/gpt-5.4", fallback: "openai-codex/gpt-5.4-mini" },
      lead: { primary: "openai-codex/gpt-5.4-mini", fallback: "openai/gpt-5-mini" },
      worker: { primary: "openai/gpt-5-mini", fallback: "openai/gpt-4.1-mini" },
    },
  };

  const agent = {
    frontmatter: {
      name: "QA Engineer",
      model: "legacy-worker-model",
      model_tier: "worker",
      expertise: "testing",
      skills: [],
      tools: {
        read: true,
        write: true,
        edit: true,
        bash: false,
        delegate: false,
        update_memory: false,
        query_notebooklm: false,
      },
      memory: {
        write_levels: [1, 2],
        domain_lock: null,
      },
      domain: {
        read: ["**/*"],
        upsert: ["workspace/**", "tests/**"],
        delete: [],
      },
    },
    body: "# QA Engineer",
    filePath: join(rootDir, "agents", "qa-engineer.md"),
  };

  const launches = [];
  const logEntries = [];
  const statuses = [];
  let task = null;

  const engine = new DelegationEngine(
    rootDir,
    config,
    {
      findAgentByName: name => name === "QA Engineer" ? agent : null,
      getAgentRole: () => "worker",
    },
    {
      assemble: () => "SYSTEM PROMPT",
    },
    {
      hasCapacity: () => true,
      launch: params => {
        launches.push(params);
        return {
          id: "proc-001",
          runtimeType: "process",
          agentName: params.agentName,
          taskId: params.taskId,
          launchedAt: new Date().toISOString(),
        };
      },
      destroy: () => {},
    },
    {
      readTask: taskId => task && task.id === taskId ? task : null,
      createTask: params => {
        task = {
          id: params.taskId,
          title: params.title,
          description: params.description,
          assignedTo: params.assignedTo,
          taskType: params.taskType,
          acceptanceCriteria: params.acceptanceCriteria,
          writeScope: ["tests/**"],
          status: "pending",
          phase: "none",
          wave: params.wave,
          dependencies: params.dependencies,
          parentTask: params.parentTask,
          planFirst: params.planFirst,
          timeBudget: params.timeBudget,
          correlationId: "corr-task-004",
        };
        return task;
      },
      updateStatus: (_taskId, status) => {
        statuses.push(status);
        if (task) task.status = status;
      },
      getTaskFilePath: taskId => join(rootDir, "workspace", "tasks", `${taskId}.md`),
    },
    {
      logEntry: (...args) => logEntries.push(args),
    },
    {
      sessionDAG: {
        createSession: () => {},
        append: () => {},
      },
      expertise: {
        ensureAgentMemory: () => {},
      },
    },
  );

  const worker = await engine.delegate({
    taskId: "task-004",
    taskTitle: "Add parity regression tests",
    taskDescription: "Cover the parity fixes with automated tests.",
    agentName: "QA Engineer",
    taskType: "qa",
    acceptanceCriteria: ["Tests exist"],
    wave: 3,
    dependencies: ["task-002", "task-003"],
    parentTaskId: null,
    planFirst: false,
    timeBudget: 600,
    delegationDepth: 2,
  });

  assert.equal(launches.length, 1);
  assert.equal(launches[0].model, "openai/gpt-5-mini");
  assert.equal(launches[0].correlationId, "corr-task-004");
  assert.deepEqual(launches[0].allowedTools, ["read", "write", "edit"]);
  assert.equal(worker.correlationId, "corr-task-004");
  assert.deepEqual(statuses, ["in_progress"]);

  const persisted = JSON.parse(readFileSync(join(rootDir, "workspace", "runtime-state", "active-workers.json"), "utf-8"));
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].correlationId, "corr-task-004");
  assert.equal(persisted[0].runtimeType, "process");

  assert.equal(logEntries.length, 2);
  assert.match(logEntries[0][1], /Switching QA Engineer from legacy-worker-model to openai\/gpt-5-mini/);
  assert.match(logEntries[1][1], /model: openai\/gpt-5-mini/);
  assert.deepEqual(logEntries[1][2], {
    taskId: "task-004",
    correlationId: "corr-task-004",
  });
});

test("DelegationEngine rebuilds runtime policy and tool access when a plan-first task enters execution", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-maestro-plan-gate-"));
  mkdirSync(join(rootDir, "workspace", "tasks"), { recursive: true });
  mkdirSync(join(rootDir, "workspace", "runtime-policies"), { recursive: true });
  mkdirSync(join(rootDir, "workspace", "runtime-state"), { recursive: true });
  mkdirSync(join(rootDir, "workspace", "runtime-sessions"), { recursive: true });
  mkdirSync(join(rootDir, "memory", "sessions"), { recursive: true });

  const config = {
    paths: {
      workspace: "workspace",
      memory: "memory",
    },
    limits: {
      max_delegation_depth: 5,
    },
    model_tier_policy: {
      curator: { primary: "openai-codex/gpt-5.4", fallback: "openai-codex/gpt-5.4-mini" },
      lead: { primary: "openai-codex/gpt-5.4-mini", fallback: "openai/gpt-5-mini" },
      worker: { primary: "openai/gpt-5-mini", fallback: "openai/gpt-4.1-mini" },
    },
  };

  const agent = {
    frontmatter: {
      name: "Backend Dev",
      model: "openai/gpt-5-mini",
      model_tier: "worker",
      expertise: "backend",
      skills: [],
      tools: {
        read: true,
        write: true,
        edit: true,
        bash: true,
        delegate: false,
        update_memory: false,
        query_notebooklm: false,
      },
      memory: {
        write_levels: [1, 2],
        domain_lock: null,
      },
      domain: {
        read: ["**/*"],
        upsert: ["workspace/**", "src/**"],
        delete: [],
      },
    },
    body: "# Backend Dev",
    filePath: join(rootDir, "agents", "backend-dev.md"),
  };

  const launches = [];
  let task = null;

  const engine = new DelegationEngine(
    rootDir,
    config,
    {
      findAgentByName: name => name === "Backend Dev" ? agent : null,
      getAgentRole: () => "worker",
    },
    {
      assemble: () => "SYSTEM PROMPT",
    },
    {
      hasCapacity: () => true,
      launch: params => {
        launches.push(params);
        return {
          id: "proc-002",
          runtimeType: "process",
          agentName: params.agentName,
          taskId: params.taskId,
          launchedAt: new Date().toISOString(),
        };
      },
      destroy: () => {},
    },
    {
      readTask: taskId => task && task.id === taskId ? task : null,
      createTask: params => {
        task = {
          id: params.taskId,
          title: params.title,
          description: params.description,
          assignedTo: params.assignedTo,
          taskType: params.taskType,
          acceptanceCriteria: params.acceptanceCriteria,
          writeScope: ["src/runtime/**"],
          status: "pending",
          phase: params.planFirst ? "phase_1_plan" : "none",
          wave: params.wave,
          dependencies: params.dependencies,
          parentTask: params.parentTask,
          planFirst: params.planFirst,
          timeBudget: params.timeBudget,
          correlationId: "corr-task-005",
        };
        return task;
      },
      updateStatus: (_taskId, status) => {
        if (!task) return;
        task.status = status;
        if (status === "plan_approved") {
          task.phase = "phase_2_execute";
        }
      },
      getTaskFilePath: taskId => join(rootDir, "workspace", "tasks", `${taskId}.md`),
    },
    {
      logEntry: () => {},
    },
    {
      sessionDAG: {
        createSession: () => {},
        append: () => {},
      },
      expertise: {
        ensureAgentMemory: () => {},
      },
    },
  );

  await engine.delegate({
    taskId: "task-005",
    taskTitle: "Implement approved backend fix",
    taskDescription: "Implement the approved runtime change under src/runtime/**.",
    agentName: "Backend Dev",
    taskType: "implementation",
    acceptanceCriteria: ["Approved plan is implemented"],
    wave: 3,
    dependencies: ["task-002"],
    parentTaskId: null,
    planFirst: true,
    timeBudget: 900,
    delegationDepth: 2,
  });

  const initialPolicy = JSON.parse(readFileSync(join(rootDir, "workspace", "runtime-policies", "task-005.json"), "utf-8"));
  assert.deepEqual(launches[0].allowedTools, ["read", "write", "edit"]);
  assert.deepEqual(initialPolicy.allowedTools, ["read", "write", "edit"]);
  assert.deepEqual(initialPolicy.domain.upsert, ["workspace/tasks/task-005.md"]);

  task.phase = "phase_2_execute";
  const refreshedPolicy = engine.refreshWorkerRuntimeContext("task-005", "phase_2_execute");

  assert.ok(refreshedPolicy);
  assert.deepEqual(refreshedPolicy.allowedTools, ["read", "write", "edit", "bash"]);
  assert.deepEqual(refreshedPolicy.domain.upsert, ["workspace/**", "src/runtime/**"]);
});
