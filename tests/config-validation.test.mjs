import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "../dist/src/config.js";

test("loadConfig rejects duplicate agent names and worker delegation in the current team schema", () => {
  const rootDir = makeRoot();

  writeConfig(rootDir, {
    teams: `
  - name: Engineering
    lead: { name: Lead One, file: lead.md, color: "#00aa00" }
    workers:
      - { name: Worker One, file: worker.md, color: "#0000aa" }
`,
  });

  writeAgent(rootDir, "maestro.md", {
    name: "Maestro",
    model: "openai-codex/gpt-5.4",
    model_tier: "curator",
    delegate: true,
    write_levels: "[1, 2, 3, 4]",
  });
  writeAgent(rootDir, "lead.md", {
    name: "Lead One",
    model: "openai-codex/gpt-5.4-mini",
    model_tier: "lead",
    delegate: true,
    write_levels: "[1, 2, 3]",
  });
  writeAgent(rootDir, "worker.md", {
    name: "Lead One",
    model: "openai-codex/gpt-5.4-mini",
    model_tier: "worker",
    delegate: true,
    write_levels: "[1, 2]",
  });

  assert.throws(
    () => loadConfig(rootDir),
    error => {
      assert.match(error.message, /Duplicate agent name/);
      assert.match(error.message, /Worker agent 'Lead One' cannot declare delegate: true/);
      return true;
    },
  );
});

test("loadConfig rejects lead teams that can delegate but have no workers configured", () => {
  const rootDir = makeRoot();

  writeConfig(rootDir, {
    teams: `
  - name: Engineering
    lead: { name: Lead One, file: lead.md, color: "#00aa00" }
    workers: []
`,
  });

  writeAgent(rootDir, "maestro.md", {
    name: "Maestro",
    model: "openai-codex/gpt-5.4",
    model_tier: "curator",
    delegate: true,
    write_levels: "[1, 2, 3, 4]",
  });
  writeAgent(rootDir, "lead.md", {
    name: "Lead One",
    model: "openai-codex/gpt-5.4-mini",
    model_tier: "lead",
    delegate: true,
    write_levels: "[1, 2, 3]",
  });

  assert.throws(
    () => loadConfig(rootDir),
    /has delegate: true but no workers are configured/,
  );
});

test("loadConfig applies the codex model preset override", () => {
  const rootDir = makeRoot();

  writeConfig(rootDir, {
    teams: `
  - name: Engineering
    lead: { name: Lead One, file: lead.md, color: "#00aa00" }
    workers:
      - { name: Worker One, file: worker.md, color: "#0000aa" }
`,
  });

  writeAgent(rootDir, "maestro.md", {
    name: "Maestro",
    model: "anthropic/claude-opus-4-6",
    model_tier: "curator",
    delegate: true,
    write_levels: "[1, 2, 3, 4]",
  });
  writeAgent(rootDir, "lead.md", {
    name: "Lead One",
    model: "anthropic/claude-opus-4-6",
    model_tier: "lead",
    delegate: true,
    write_levels: "[1, 2, 3]",
  });
  writeAgent(rootDir, "worker.md", {
    name: "Worker One",
    model: "anthropic/claude-sonnet-4-6",
    model_tier: "worker",
    delegate: false,
    write_levels: "[1, 2]",
  });

  withEnv({ MAESTRO_MODEL_PRESET: "codex" }, () => {
    const config = loadConfig(rootDir);
    assert.deepEqual(config.model_tier_policy, {
      curator: {
        primary: "openai-codex/gpt-5.4",
        fallback: "openai-codex/gpt-5.4-mini",
      },
      lead: {
        primary: "openai-codex/gpt-5.4",
        fallback: "openai-codex/gpt-5.4-mini",
      },
      worker: {
        primary: "openai-codex/gpt-5.4-mini",
        fallback: "openai-codex/gpt-5.4",
      },
    });
  });
});

test("loadConfig rejects unsupported model presets", () => {
  const rootDir = makeRoot();

  writeConfig(rootDir, {
    teams: `
  - name: Engineering
    lead: { name: Lead One, file: lead.md, color: "#00aa00" }
    workers:
      - { name: Worker One, file: worker.md, color: "#0000aa" }
`,
  });

  writeAgent(rootDir, "maestro.md", {
    name: "Maestro",
    model: "openai-codex/gpt-5.4",
    model_tier: "curator",
    delegate: true,
    write_levels: "[1, 2, 3, 4]",
  });
  writeAgent(rootDir, "lead.md", {
    name: "Lead One",
    model: "openai-codex/gpt-5.4-mini",
    model_tier: "lead",
    delegate: true,
    write_levels: "[1, 2, 3]",
  });
  writeAgent(rootDir, "worker.md", {
    name: "Worker One",
    model: "openai-codex/gpt-5.4-mini",
    model_tier: "worker",
    delegate: false,
    write_levels: "[1, 2]",
  });

  assert.throws(
    () => withEnv({ MAESTRO_MODEL_PRESET: "mistral" }, () => loadConfig(rootDir)),
    /Unsupported MAESTRO_MODEL_PRESET 'mistral'/,
  );
});

function makeRoot() {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-maestro-config-"));
  mkdirSync(join(rootDir, "agents"), { recursive: true });
  mkdirSync(join(rootDir, "skills"), { recursive: true });
  mkdirSync(join(rootDir, "workspace"), { recursive: true });
  mkdirSync(join(rootDir, "memory"), { recursive: true });
  mkdirSync(join(rootDir, "logs"), { recursive: true });
  mkdirSync(join(rootDir, "shared-context"), { recursive: true });
  return rootDir;
}

function writeConfig(rootDir, { teams }) {
  writeFileSync(join(rootDir, "multi-team-config.yaml"), `schema_version: 1
project_name: test-project
paths:
  workspace: workspace
  agents: agents
  skills: skills
  memory: memory
  logs: logs
  shared_context: shared-context
maestro:
  name: Maestro
  file: maestro.md
  color: "#111111"
model_tier_policy:
  curator:
    primary: openai-codex/gpt-5.4
    fallback: openai-codex/gpt-5.4-mini
  lead:
    primary: openai-codex/gpt-5.4-mini
    fallback: openai/gpt-5
  worker:
    primary: openai-codex/gpt-5.4-mini
    fallback: openai/gpt-5-mini
memory:
  session_retention_days: 7
  daily_retention_days: 30
  expertise_token_budget: 3000
  knowledge_graph_token_budget: 2000
  compaction_threshold: 0.8
  compaction_interval_days: 7
  low_confidence_threshold: 0.3
limits:
  max_panes: 4
  max_delegation_depth: 5
  stall_timeout_seconds: 60
  task_timeout_seconds: 600
  wave_timeout_seconds: 1800
  max_reconcile_retries: 2
  max_retry_attempts: 3
  escalate_after_seconds: 300
tmux_session: agent-maestro-test
teams:${teams}`, "utf-8");
}

function writeAgent(rootDir, fileName, { name, model, model_tier, delegate, write_levels }) {
  writeFileSync(join(rootDir, "agents", fileName), `---
schema_version: 1
name: ${JSON.stringify(name)}
model: ${JSON.stringify(model)}
model_tier: ${model_tier}
expertise: ${JSON.stringify(`${name} expertise`)}
skills: []
tools:
  read: true
  write: true
  bash: false
  edit: true
  delegate: ${delegate}
  update_memory: false
  query_notebooklm: false
memory:
  write_levels: ${write_levels}
  domain_lock: null
domain:
  read: ["**/*"]
  upsert: ["workspace/**"]
  delete: []
---

# ${name}
`, "utf-8");
}

function withEnv(overrides, fn) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (typeof value === "undefined") {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}
