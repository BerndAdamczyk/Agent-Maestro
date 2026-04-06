import test from "node:test";
import assert from "node:assert/strict";

import { validateHandoffReport } from "../dist/src/handoff-validator.js";

test("validateHandoffReport accepts explicit none markers with punctuation", () => {
  const validation = validateHandoffReport({
    changesMade: "Created workspace/pong.md and updated the task file with the handoff report.",
    patternsFollowed: "Followed the task file contract and wrote the requested artifact to workspace/.",
    unresolvedConcerns: "None.",
    suggestedFollowups: "None.",
  });

  assert.equal(validation.status, "valid");
  assert.deepEqual(validation.issues, []);
});
