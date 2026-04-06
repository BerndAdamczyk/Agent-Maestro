import test from "node:test";
import assert from "node:assert/strict";

import { buildBuiltinTaskPlanIfApplicable } from "../dist/src/task-plan-provider.js";
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

function makeAgentResolver() {
  return {
    findAgentByName(name) {
      return { frontmatter: { name } };
    },
  };
}
