import test from "node:test";
import assert from "node:assert/strict";

import { classifyFile } from "../dist/web/server/services/file-watcher.js";
import { serializeFileChangeEvent } from "../dist/web/server/ws/handler.js";

test("classifyFile recognizes workspace log jsonl updates as log events", () => {
  assert.equal(classifyFile("workspace/log.jsonl"), "log");
  assert.equal(classifyFile("workspace/log.md"), "log");
});

test("serializeFileChangeEvent preserves the websocket event kind separately from file type", () => {
  const payload = JSON.parse(serializeFileChangeEvent({
    type: "task",
    path: "workspace/tasks/task-001.md",
    content: "# task-001",
    timestamp: "2026-04-06T18:00:00+02:00",
  }));

  assert.deepEqual(payload, {
    type: "file:changed",
    fileType: "task",
    path: "workspace/tasks/task-001.md",
    content: "# task-001",
    timestamp: "2026-04-06T18:00:00+02:00",
  });
});
