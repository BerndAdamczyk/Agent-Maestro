import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RuntimePolicyManager } from "../dist/src/runtime/policy.js";

test("RuntimePolicyManager narrows write authority to task write scope plus workspace", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-maestro-policy-"));
  mkdirSync(join(rootDir, "workspace", "runtime-policies"), { recursive: true });
  mkdirSync(join(rootDir, "workspace", "runtime-sessions"), { recursive: true });
  mkdirSync(join(rootDir, "memory", "sessions"), { recursive: true });
  mkdirSync(join(rootDir, "src", "runtime"), { recursive: true });
  mkdirSync(join(rootDir, "docs"), { recursive: true });
  writeFileSync(join(rootDir, "docs", "arc42-architecture.md"), "# docs\n", "utf-8");

  const manager = new RuntimePolicyManager(rootDir, {
    paths: {
      workspace: "workspace",
      memory: "memory",
    },
  });

  const manifest = manager.build({
    taskId: "task-004",
    agentName: "Backend Dev",
    role: "worker",
    phase: "none",
    taskFilePath: join(rootDir, "workspace", "tasks", "task-004.md"),
    allowedTools: ["read", "write", "edit", "bash"],
    domain: {
      read: ["**/*"],
      upsert: ["workspace/**", "src/**"],
      delete: [],
    },
    taskWriteScope: ["src/runtime/**", "docs/arc42-architecture.md"],
  });

  assert.deepEqual(manifest.domain.upsert, [
    "workspace/**",
    "src/runtime/**",
    "docs/arc42-architecture.md",
  ]);
  assert.ok(manifest.writeRoots.includes("workspace"));
  assert.ok(manifest.writeRoots.includes("src"));
  assert.ok(manifest.writeRoots.includes("docs/arc42-architecture.md"));
});
