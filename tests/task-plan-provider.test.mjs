import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildBuiltinTaskPlanIfApplicable,
  normalizeExplicitRepoPathText,
  normalizeTaskPlanExplicitRepoPaths,
} from "../dist/src/task-plan-provider.js";
import { resolveTaskPlan } from "../dist/src/task-plan.js";

test("buildBuiltinTaskPlanIfApplicable returns a deterministic ping health-check plan", () => {
  const plan = buildBuiltinTaskPlanIfApplicable("# Goal\n\nping\n\n_Created: 2026-04-06T00:00:00Z_\n");

  assert.ok(plan);
  assert.equal(plan.goal, "ping");
  assert.equal(plan.tasks[0].assigned_to, "Product Manager");
  assert.match(plan.validation_commands[0], /workspace\/pong\.md/);
  assert.deepEqual(plan.tasks[0].write_scope, ["workspace/pong.md"]);
});

test("resolveTaskPlan rejects llm plans without write_scope", () => {
  assert.throws(() => resolveTaskPlan({
    schema_version: 1,
    goal: "Fix runtime policy",
    tasks: [
      {
        id: "task-001",
        title: "Fix runtime policy",
        description: "Patch runtime policy handling.",
        assigned_to: "Backend Dev",
        task_type: "implementation",
        dependencies: [],
        parent_task: null,
        plan_first: false,
        time_budget: 600,
        acceptance_criteria: ["Policy change is implemented."],
        write_scope: [],
      },
    ],
    validation_commands: [],
  }, makeAgentResolver(), "llm", "llm://planner"), /must declare write_scope/);
});

test("resolveTaskPlan rejects overlapping same-wave write scopes", () => {
  assert.throws(() => resolveTaskPlan({
    schema_version: 1,
    goal: "Fix overlapping work",
    tasks: [
      {
        id: "task-001",
        title: "Patch runtime docs",
        description: "Update docs.",
        assigned_to: "Engineering Lead",
        task_type: "implementation",
        dependencies: [],
        parent_task: null,
        plan_first: false,
        time_budget: 600,
        acceptance_criteria: ["Docs updated."],
        write_scope: ["docs/arc42-architecture.md"],
      },
      {
        id: "task-002",
        title: "Patch runtime docs again",
        description: "Update docs too.",
        assigned_to: "Backend Dev",
        task_type: "implementation",
        dependencies: [],
        parent_task: null,
        plan_first: false,
        time_budget: 600,
        acceptance_criteria: ["Docs updated again."],
        write_scope: ["docs/arc42-architecture.md"],
      },
    ],
    validation_commands: [],
  }, makeAgentResolver(), "llm", "llm://planner"), /share overlapping write_scope/);
});

test("normalizeExplicitRepoPathText corrects obvious typos in explicit local file references", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-maestro-paths-"));
  mkdirSync(join(rootDir, "docs"), { recursive: true });
  writeFileSync(join(rootDir, "docs", "maestro-local-changes-feedback.md"), "# feedback\n", "utf-8");

  const result = normalizeExplicitRepoPathText(
    "Implement the issues from ./docs/meastro.local-changes-feedback.md first.",
    rootDir,
  );

  assert.equal(
    result.text,
    "Implement the issues from ./docs/maestro-local-changes-feedback.md first.",
  );
  assert.deepEqual(result.unresolved, []);
  assert.deepEqual(result.rewrites, [
    {
      from: "./docs/meastro.local-changes-feedback.md",
      to: "./docs/maestro-local-changes-feedback.md",
    },
  ]);
});

test("normalizeExplicitRepoPathText preserves trailing punctuation around corrected paths", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-maestro-paths-"));
  mkdirSync(join(rootDir, "docs"), { recursive: true });
  writeFileSync(join(rootDir, "docs", "maestro-local-changes-feedback.md"), "# feedback\n", "utf-8");

  const result = normalizeExplicitRepoPathText(
    "Implement the issues from ./docs/meastro.local-changes-feedback.md, then continue.",
    rootDir,
  );

  assert.equal(
    result.text,
    "Implement the issues from ./docs/maestro-local-changes-feedback.md, then continue.",
  );
  assert.deepEqual(result.unresolved, []);
  assert.deepEqual(result.rewrites, [
    {
      from: "./docs/meastro.local-changes-feedback.md,",
      to: "./docs/maestro-local-changes-feedback.md,",
    },
  ]);
});

test("normalizeExplicitRepoPathText reports unresolved explicit local file references", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-maestro-paths-"));
  mkdirSync(join(rootDir, "docs"), { recursive: true });

  const result = normalizeExplicitRepoPathText(
    "Review ./docs/does-not-exist.md before planning.",
    rootDir,
  );

  assert.equal(result.text, "Review ./docs/does-not-exist.md before planning.");
  assert.deepEqual(result.rewrites, []);
  assert.deepEqual(result.unresolved, ["./docs/does-not-exist.md"]);
});

test("normalizeTaskPlanExplicitRepoPaths also corrects task write scope", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-maestro-paths-"));
  mkdirSync(join(rootDir, "docs"), { recursive: true });
  writeFileSync(join(rootDir, "docs", "maestro-local-changes-feedback.md"), "# feedback\n", "utf-8");

  const result = normalizeTaskPlanExplicitRepoPaths({
    schema_version: 1,
    goal: "Review ./docs/meastro.local-changes-feedback.md.",
    tasks: [
      {
        id: "task-001",
        title: "Review feedback",
        description: "Use ./docs/meastro.local-changes-feedback.md to drive the task.",
        assigned_to: "Product Manager",
        task_type: "general",
        dependencies: [],
        parent_task: null,
        plan_first: false,
        time_budget: 60,
        acceptance_criteria: ["Read ./docs/meastro.local-changes-feedback.md."],
        write_scope: ["./docs/meastro.local-changes-feedback.md"],
      },
    ],
    validation_commands: ["test -f ./docs/meastro.local-changes-feedback.md"],
  }, rootDir);

  assert.deepEqual(result.plan.tasks[0].write_scope, ["./docs/maestro-local-changes-feedback.md"]);
  assert.deepEqual(result.unresolved, []);
});

function makeAgentResolver() {
  return {
    findAgentByName(name) {
      return { frontmatter: { name } };
    },
  };
}
