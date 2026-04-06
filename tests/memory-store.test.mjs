import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DailyProtocolFlusher } from "../dist/src/memory/daily-protocol.js";
import { ExpertiseStore } from "../dist/src/memory/expertise-store.js";
import { MemoryAccessControl } from "../dist/src/memory/access-control.js";

test("DailyProtocolFlusher appends to existing sections without overwriting prior entries", () => {
  const memoryDir = mkdtempSync(join(tmpdir(), "agent-maestro-memory-"));
  const flusher = new DailyProtocolFlusher(memoryDir, 30);
  const today = new Date().toISOString().slice(0, 10);
  const filePath = join(memoryDir, "daily", `${today}.md`);

  writeFileSync(filePath, `# Daily Protocol: ${today}

## Findings

- [08:00] (Planner, confidence: 0.8) Existing finding

## Error Patterns

- [08:05] (Planner, confidence: 0.7) Existing error

## Decisions

- [08:10] (Planner, confidence: 0.9) Existing decision
`, "utf-8");

  flusher.flush([
    {
      time: "09:15",
      agent: "QA Engineer",
      confidence: 0.91,
      content: "New regression finding",
      sourceTask: "task-004",
      category: "finding",
    },
    {
      time: "09:20",
      agent: "QA Engineer",
      confidence: 0.88,
      content: "Keep websocket payload assertions narrow",
      sourceTask: "task-004",
      category: "decision",
    },
  ]);

  const content = readFileSync(filePath, "utf-8");
  assert.match(content, /Existing finding/);
  assert.match(content, /New regression finding/);
  assert.match(content, /Existing decision/);
  assert.match(content, /Keep websocket payload assertions narrow/);
  assert.match(content, /## Error Patterns\n\n- \[08:05\]/);
});

test("ExpertiseStore appends learned patterns and expert notes into the correct sections", () => {
  const memoryDir = mkdtempSync(join(tmpdir(), "agent-maestro-expertise-"));
  const store = new ExpertiseStore(memoryDir, new MemoryAccessControl());
  const agentFrontmatter = {
    name: "QA Engineer",
    model: "openai/gpt-5-mini",
    model_tier: "lead",
    expertise: "testing",
    skills: [],
    tools: {
      read: true,
      write: true,
      bash: false,
      edit: true,
      delegate: true,
      update_memory: true,
      query_notebooklm: false,
    },
    memory: {
      write_levels: [1, 2, 3],
      domain_lock: "testing",
    },
    domain: {
      read: ["**/*"],
      upsert: ["memory/**"],
      delete: [],
    },
  };

  store.ensureAgentMemory("QA Engineer");
  store.appendToMemory("QA Engineer", agentFrontmatter, "Patterns Learned", {
    content: "Preserve existing markdown sections during append operations",
    confidence: 0.86,
    source: "task-004",
    date: "2026-04-06",
  });
  store.appendToExpert("QA Engineer", agentFrontmatter, "testing", "Architecture Patterns", {
    content: "Use API-level tests for local web hardening middleware",
    confidence: 0.8,
    source: "task-004",
    date: "2026-04-06",
  });

  const memoryDoc = store.readMemory("QA Engineer");
  const expertDoc = store.readExpert("QA Engineer");

  assert.match(memoryDoc, /## Patterns Learned\n\n- \*\*Preserve existing markdown sections during append operations\*\*/);
  assert.match(memoryDoc, /updated: 2026-04-06/);
  assert.match(expertDoc, /domain: "testing"/);
  assert.match(expertDoc, /owner: "QA Engineer"/);
  assert.match(expertDoc, /## Architecture Patterns\n\n- \*\*Use API-level tests for local web hardening middleware\*\*/);
});
