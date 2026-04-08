import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DelegationEngine } from "../dist/src/delegation-engine.js";

test("DelegationEngine provisions a parked worktree for mutating tasks and reuses it on later launches", async () => {
  const rootDir = join(tmpdir(), `agent-maestro-worktree-${Date.now()}`);
  mkdirSync(rootDir, { recursive: true });
  mkdirSync(join(rootDir, "workspace", "tasks"), { recursive: true });
  mkdirSync(join(rootDir, "workspace", "runtime-policies"), { recursive: true });
  mkdirSync(join(rootDir, "workspace", "runtime-state"), { recursive: true });
  mkdirSync(join(rootDir, "workspace", "runtime-sessions"), { recursive: true });
  mkdirSync(join(rootDir, "memory", "sessions"), { recursive: true });
  mkdirSync(join(rootDir, "src"), { recursive: true });
  writeFileSync(join(rootDir, "src", "index.ts"), "export const value = 1;\n", "utf-8");

  execFileSync("git", ["init"], { cwd: rootDir, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: rootDir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: rootDir, stdio: "ignore" });
  execFileSync("git", ["add", "."], { cwd: rootDir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: rootDir, stdio: "ignore" });

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

  let task = null;
  const launches = [];
  const runtime = {
    hasCapacity: () => true,
    launch: params => {
      launches.push(params);
      return {
        id: `proc-${launches.length}`,
        runtimeType: "process",
        agentName: params.agentName,
        taskId: params.taskId,
        launchedAt: new Date().toISOString(),
      };
    },
    destroy: () => {},
  };

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
    runtime,
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
          correlationId: "corr-task-007",
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
    taskId: "task-007",
    taskTitle: "Implement isolated runtime change",
    taskDescription: "Edit runtime code under src/**.",
    agentName: "Backend Dev",
    taskType: "implementation",
    acceptanceCriteria: ["Launch uses isolated workspace root"],
    wave: 1,
    dependencies: [],
    parentTaskId: null,
    planFirst: false,
    timeBudget: 300,
    delegationDepth: 1,
  });

  assert.equal(launches.length, 1);
  assert.notEqual(launches[0].workspaceRoot, rootDir);
  assert.ok(existsSync(join(launches[0].workspaceRoot, ".git")));

  engine.completeWorker("task-007", "failed");

  const metadataPath = join(rootDir, "workspace", "runtime-state", "worktrees", "task-007.json");
  const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
  assert.equal(metadata.status, "parked");

  await engine.delegate({
    taskId: "task-007",
    taskTitle: "Implement isolated runtime change",
    taskDescription: "Edit runtime code under src/**.",
    agentName: "Backend Dev",
    taskType: "implementation",
    acceptanceCriteria: ["Launch reuses parked workspace root"],
    wave: 1,
    dependencies: [],
    parentTaskId: null,
    planFirst: false,
    timeBudget: 300,
    delegationDepth: 1,
  });

  assert.equal(launches[1].workspaceRoot, launches[0].workspaceRoot);

  engine.completeWorker("task-007", "complete");
  assert.equal(existsSync(metadataPath), false);
  assert.equal(existsSync(launches[0].workspaceRoot), false);
});
