import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TaskManager } from "../dist/src/task-manager.js";

test("parseTaskFile accepts handoff reports under the standard heading", () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), "agent-maestro-task-"));
  mkdirSync(join(workspaceDir, "tasks"), { recursive: true });
  const manager = new TaskManager(workspaceDir);

  const parsed = manager.parseTaskFile(`
# task-001: Example

**Status:** complete
**Correlation ID:** corr-1
**Assigned To:** Product Manager
**Task Type:** general
**Wave:** 1
**Phase:** none
**Plan First:** false
**Time Budget:** 60s
**Dependencies:** none
**Parent Task:** none
**Created:** 2026-04-06T00:00:00.000Z
**Updated:** 2026-04-06T00:01:00.000Z

## Description

Example task

## Handoff Report

### Changes Made
Created workspace/pong.md

### Patterns Followed
Followed the workspace handoff contract.

### Unresolved Concerns
None.

### Suggested Follow-ups
None.
`.trim(), "task-001");

  assert.deepEqual(parsed.handoffReport, {
    changesMade: "Created workspace/pong.md",
    patternsFollowed: "Followed the workspace handoff contract.",
    unresolvedConcerns: "None.",
    suggestedFollowups: "None.",
  });
});

test("parseTaskFile accepts handoff subsections with a blank line after the heading", () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), "agent-maestro-task-"));
  mkdirSync(join(workspaceDir, "tasks"), { recursive: true });
  const manager = new TaskManager(workspaceDir);

  const parsed = manager.parseTaskFile(`
# task-001: Example

**Status:** complete
**Correlation ID:** corr-1
**Assigned To:** Product Manager
**Task Type:** general
**Wave:** 1
**Phase:** none
**Plan First:** false
**Time Budget:** 60s
**Dependencies:** none
**Parent Task:** none
**Created:** 2026-04-06T00:00:00.000Z
**Updated:** 2026-04-06T00:01:00.000Z

## Description

Example task

## Handoff Report

### Changes Made

Created workspace/pong.md

### Patterns Followed

Followed the workspace handoff contract.

### Unresolved Concerns

None.

### Suggested Follow-ups

None.
`.trim(), "task-001");

  assert.deepEqual(parsed.handoffReport, {
    changesMade: "Created workspace/pong.md",
    patternsFollowed: "Followed the workspace handoff contract.",
    unresolvedConcerns: "None.",
    suggestedFollowups: "None.",
  });
});

test("parseTaskFile accepts handoff reports under the shorthand heading", () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), "agent-maestro-task-"));
  mkdirSync(join(workspaceDir, "tasks"), { recursive: true });
  const manager = new TaskManager(workspaceDir);

  const parsed = manager.parseTaskFile(`
# task-001: Example

**Status:** complete
**Correlation ID:** corr-1
**Assigned To:** Product Manager
**Task Type:** general
**Wave:** 1
**Phase:** none
**Plan First:** false
**Time Budget:** 60s
**Dependencies:** none
**Parent Task:** none
**Created:** 2026-04-06T00:00:00.000Z
**Updated:** 2026-04-06T00:01:00.000Z

## Description

Example task

## Handoff

### Changes Made
Created workspace/pong.md

### Patterns Followed
Followed the workspace handoff contract.

### Unresolved Concerns
None.

### Suggested Follow-ups
None.
`.trim(), "task-001");

  assert.deepEqual(parsed.handoffReport, {
    changesMade: "Created workspace/pong.md",
    patternsFollowed: "Followed the workspace handoff contract.",
    unresolvedConcerns: "None.",
    suggestedFollowups: "None.",
  });
});

test("createTask uses local ISO timestamps with explicit offsets", () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), "agent-maestro-task-"));
  mkdirSync(join(workspaceDir, "tasks"), { recursive: true });
  const manager = new TaskManager(workspaceDir);

  const task = manager.createTask({
    title: "Example",
    description: "Example task",
    assignedTo: "Product Manager",
    wave: 1,
  });

  assert.match(task.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
  assert.match(task.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
});

test("createTask persists write scope metadata", () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), "agent-maestro-task-"));
  mkdirSync(join(workspaceDir, "tasks"), { recursive: true });
  const manager = new TaskManager(workspaceDir);

  const task = manager.createTask({
    title: "Scoped task",
    description: "Update runtime policy wiring.",
    assignedTo: "Backend Dev",
    wave: 2,
    writeScope: ["src/runtime/**", "docs/arc42-architecture.md"],
  });

  const parsed = manager.readTask(task.id);

  assert.deepEqual(parsed?.writeScope, ["src/runtime/**", "docs/arc42-architecture.md"]);
});
