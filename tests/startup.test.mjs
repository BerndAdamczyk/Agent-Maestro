import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAgentRuntime, hasExistingSessionState } from "../dist/src/startup.js";
import { ConfigError } from "../dist/src/errors.js";
import { HybridAgentRuntime } from "../dist/src/runtime/hybrid-agent-runtime.js";
import { PlainProcessAgentRuntime } from "../dist/src/runtime/plain-process-runtime.js";
import { TmuxAgentRuntime } from "../dist/src/runtime/tmux-agent-runtime.js";

const baseConfig = {
  tmux_session: "agent-maestro-test",
  limits: {
    max_panes: 4,
  },
};

test("createAgentRuntime auto mode stays on plain-process even when docker is available", () => {
  const runtime = createAgentRuntime("auto", baseConfig, {
    hasTmuxBinary: () => true,
    hasDockerRuntime: () => true,
    devMode: false,
  });

  assert.ok(runtime instanceof PlainProcessAgentRuntime);
});

test("createAgentRuntime auto mode honors dev mode and keeps host runtime", () => {
  const runtime = createAgentRuntime("auto", baseConfig, {
    hasTmuxBinary: () => true,
    hasDockerRuntime: () => true,
    devMode: true,
  });

  assert.ok(runtime instanceof TmuxAgentRuntime);
});

test("createAgentRuntime container mode uses hybrid runtime when docker is available", () => {
  const runtime = createAgentRuntime("container", baseConfig, {
    hasTmuxBinary: () => true,
    hasDockerRuntime: () => true,
    devMode: false,
  });

  assert.ok(runtime instanceof HybridAgentRuntime);
  assert.ok(runtime.hostRuntime instanceof TmuxAgentRuntime);
});

test("createAgentRuntime container mode falls back to host runtime when docker is unavailable", () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  let runtime;

  try {
    runtime = createAgentRuntime("container", baseConfig, {
      hasTmuxBinary: () => true,
      hasDockerRuntime: () => false,
      devMode: false,
    });
  } finally {
    console.warn = originalWarn;
  }

  assert.ok(runtime instanceof TmuxAgentRuntime);
});

test("createAgentRuntime auto mode falls back to plain-process when host tooling is unavailable", () => {
  const runtime = createAgentRuntime("auto", baseConfig, {
    hasTmuxBinary: () => false,
    hasDockerRuntime: () => false,
    devMode: false,
  });

  assert.ok(runtime instanceof PlainProcessAgentRuntime);
});

test("createAgentRuntime rejects unsupported runtime modes with a structured config error", () => {
  assert.throws(
    () => createAgentRuntime("bogus-mode", baseConfig, {
      hasTmuxBinary: () => false,
      hasDockerRuntime: () => false,
      devMode: false,
    }),
    error => error instanceof ConfigError && error.code === "UNSUPPORTED_RUNTIME_MODE",
  );
});

test("hasExistingSessionState ignores an authoritative plan file on a fresh workspace", () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), "agent-maestro-startup-"));
  writeFileSync(join(workspaceDir, "plan.md"), "# Task Plan\n", "utf-8");

  assert.equal(hasExistingSessionState(workspaceDir), false);
});

test("hasExistingSessionState detects generated session artifacts", () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), "agent-maestro-startup-"));
  mkdirSync(join(workspaceDir, "runtime-sessions"), { recursive: true });
  writeFileSync(join(workspaceDir, "runtime-sessions", "task-001.jsonl"), "", "utf-8");

  assert.equal(hasExistingSessionState(workspaceDir), true);
});
