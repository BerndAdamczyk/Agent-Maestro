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

  const intents = JSON.parse(readFileSync(join(rootDir, "workspace", "runtime-state", "execution-intents.json"), "utf-8"));
  assert.equal(intents.length, 1);
  assert.equal(intents[0].status, "completed");
  assert.equal(intents[0].attempts, 1);
  assert.match(intents[0].dedupeKey, /^launch:task-004$/);
  assert.deepEqual(
    intents[0].events.map(event => event.lifecycle),
    ["launch_requested", "launch_started", "running"],
  );

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

test("DelegationEngine honors MAESTRO_MODEL_PRESET over the agent frontmatter model", async () => {
  const previousPreset = process.env["MAESTRO_MODEL_PRESET"];
  const previousAnthropicKey = process.env["ANTHROPIC_API_KEY"];
  process.env["MAESTRO_MODEL_PRESET"] = "codex";
  process.env["ANTHROPIC_API_KEY"] = "anthropic-key";

  try {
    const rootDir = mkdtempSync(join(tmpdir(), "agent-maestro-delegation-preset-"));
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
        lead: { primary: "openai-codex/gpt-5.4", fallback: "openai-codex/gpt-5.4-mini" },
        worker: { primary: "openai-codex/gpt-5.4-mini", fallback: "openai-codex/gpt-5.4" },
      },
    };

    const agent = {
      frontmatter: {
        name: "Backend Dev",
        model: "anthropic/claude-sonnet-4-6",
        model_tier: "worker",
        expertise: "backend",
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
            id: "proc-003",
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
            writeScope: ["src/**"],
            status: "pending",
            phase: "none",
            wave: params.wave,
            dependencies: params.dependencies,
            parentTask: params.parentTask,
            planFirst: params.planFirst,
            timeBudget: params.timeBudget,
            correlationId: "corr-task-006",
          };
          return task;
        },
        updateStatus: (_taskId, status) => {
          if (task) task.status = status;
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
      taskId: "task-006",
      taskTitle: "Use selected model preset",
      taskDescription: "Verify model selection honors the configured preset.",
      agentName: "Backend Dev",
      taskType: "implementation",
      acceptanceCriteria: ["Launch uses the preset model family"],
      wave: 2,
      dependencies: [],
      parentTaskId: null,
      planFirst: false,
      timeBudget: 300,
      delegationDepth: 2,
    });

    assert.equal(launches.length, 1);
    assert.equal(launches[0].model, "openai-codex/gpt-5.4-mini");
  } finally {
    if (typeof previousPreset === "undefined") {
      delete process.env["MAESTRO_MODEL_PRESET"];
    } else {
      process.env["MAESTRO_MODEL_PRESET"] = previousPreset;
    }

    if (typeof previousAnthropicKey === "undefined") {
      delete process.env["ANTHROPIC_API_KEY"];
    } else {
      process.env["ANTHROPIC_API_KEY"] = previousAnthropicKey;
    }
  }
});

test("DelegationEngine persists queued launch intents and replays them without duplicating queue entries", async () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-maestro-delegation-replay-"));
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
        upsert: ["workspace/**", "src/**"],
        delete: [],
      },
    },
    body: "# Backend Dev",
    filePath: join(rootDir, "agents", "backend-dev.md"),
  };

  let task = null;
  const taskManager = {
    readTask: taskId => task && task.id === taskId ? task : null,
    createTask: params => {
      task = {
        id: params.taskId,
        title: params.title,
        description: params.description,
        assignedTo: params.assignedTo,
        taskType: params.taskType,
        acceptanceCriteria: params.acceptanceCriteria,
        writeScope: ["src/**"],
        status: "pending",
        phase: "none",
        wave: params.wave,
        dependencies: params.dependencies,
        parentTask: params.parentTask,
        planFirst: params.planFirst,
        timeBudget: params.timeBudget,
        correlationId: "corr-task-007",
      };
      return task;
    },
    updateStatus: (_taskId, status) => {
      if (task) task.status = status;
    },
    getTaskFilePath: taskId => join(rootDir, "workspace", "tasks", `${taskId}.md`),
    getAllTasks: () => task ? [task] : [],
  };

  const baseArgs = [
    rootDir,
    config,
    {
      findAgentByName: name => name === "Backend Dev" ? agent : null,
      getAgentRole: () => "worker",
    },
    {
      assemble: () => "SYSTEM PROMPT",
    },
  ];

  const engine = new DelegationEngine(
    ...baseArgs,
    {
      hasCapacity: () => false,
      launch: () => {
        throw new Error("launch should not be called while capacity is exhausted");
      },
      destroy: () => {},
    },
    taskManager,
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

  await assert.rejects(
    engine.delegate({
      taskId: "task-007",
      taskTitle: "Replay durable launch queue",
      taskDescription: "Persist a queued launch and replay it on resume.",
      agentName: "Backend Dev",
      taskType: "implementation",
      acceptanceCriteria: ["Queued launch is replayable"],
      wave: 1,
      dependencies: [],
      parentTaskId: null,
      planFirst: false,
      timeBudget: 300,
      delegationDepth: 1,
    }),
    error => error?.code === "SPAWN_BUDGET_EXHAUSTED",
  );

  const queuedIntents = JSON.parse(readFileSync(join(rootDir, "workspace", "runtime-state", "execution-intents.json"), "utf-8"));
  assert.equal(queuedIntents.length, 1);
  assert.equal(queuedIntents[0].status, "pending");
  assert.equal(engine.getQueueLength(), 1);

  task.status = "in_progress";

  const replayEngine = new DelegationEngine(
    ...baseArgs,
    {
      hasCapacity: () => true,
      launch: () => ({
        id: "proc-007",
        runtimeType: "process",
        agentName: "Backend Dev",
        taskId: "task-007",
        launchedAt: new Date().toISOString(),
      }),
      destroy: () => {},
    },
    taskManager,
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

  const firstReplay = replayEngine.replayPendingDelegations();
  const secondReplay = replayEngine.replayPendingDelegations();

  assert.equal(firstReplay.length, 1);
  assert.equal(firstReplay[0].taskId, "task-007");
  assert.equal(secondReplay.length, 0);
  assert.equal(replayEngine.getQueueLength(), 1);
});
