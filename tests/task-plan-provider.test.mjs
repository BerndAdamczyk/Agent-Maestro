import test from "node:test";
import assert from "node:assert/strict";

import { buildBuiltinTaskPlanIfApplicable } from "../dist/src/task-plan-provider.js";

test("buildBuiltinTaskPlanIfApplicable returns a deterministic ping health-check plan", () => {
  const plan = buildBuiltinTaskPlanIfApplicable("# Goal\n\nping\n\n_Created: 2026-04-06T00:00:00Z_\n");

  assert.ok(plan);
  assert.equal(plan.goal, "ping");
  assert.equal(plan.tasks[0].assigned_to, "Product Manager");
  assert.match(plan.validation_commands[0], /workspace\/pong\.md/);
});
