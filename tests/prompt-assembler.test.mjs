import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PromptAssembler } from "../dist/src/prompt-assembler.js";

test("PromptAssembler includes tracked and local shared context markdown files", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-maestro-prompt-"));
  mkdirSync(join(rootDir, "shared-context"), { recursive: true });
  mkdirSync(join(rootDir, "workspace"), { recursive: true });
  mkdirSync(join(rootDir, "memory", "sessions"), { recursive: true });

  writeFileSync(join(rootDir, "shared-context", "README.md"), "# Shared\n\nTracked context\n", "utf-8");
  writeFileSync(join(rootDir, "shared-context", "LOCAL.md"), "# Local\n\nRunner-only context\n", "utf-8");
  writeFileSync(join(rootDir, "workspace", "goal.md"), "# Goal\n\nImprove self\n", "utf-8");

  const assembler = new PromptAssembler(rootDir, {
    paths: {
      workspace: "workspace",
      shared_context: "shared-context",
      memory: "memory",
    },
    memory: {
      expertise_token_budget: 1000,
    },
    model_tier_policy: {
      curator: { primary: "openai-codex/gpt-5.4", fallback: "openai-codex/gpt-5.4-mini" },
      lead: { primary: "openai-codex/gpt-5.4", fallback: "openai-codex/gpt-5.4-mini" },
      worker: { primary: "openai-codex/gpt-5.4-mini", fallback: "openai-codex/gpt-5.4" },
    },
  }, {
    expertise: {
      readMemory: () => "",
      readExpert: () => "",
    },
    knowledgeGraph: {
      loadBranches: () => "",
    },
  });

  const prompt = assembler.assemble({
    body: "System body",
    filePath: "agents/test.md",
    frontmatter: {
      name: "Test Agent",
      model_tier: "worker",
      model: "openai-codex/gpt-5.4",
      skills: [],
      memory: {
        domain_lock: null,
      },
    },
  }, {
    taskId: "task-001",
    taskTitle: "Example",
    taskType: "general",
    wave: 1,
    phase: "none",
    timeBudget: 60,
    taskDescription: "Example task",
    acceptanceCriteria: [],
    planFirst: false,
  });

  assert.match(prompt, /Tracked context/);
  assert.match(prompt, /Runner-only context/);
});
