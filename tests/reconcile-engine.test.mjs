import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ReconcileEngine } from "../dist/src/reconcile-engine.js";

test("ReconcileEngine persists successful reconciliation intents", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-maestro-reconcile-"));
  mkdirSync(join(rootDir, "workspace", "runtime-state"), { recursive: true });
  const engine = new ReconcileEngine(
    rootDir,
    {
      paths: { workspace: "workspace" },
      limits: { max_reconcile_retries: 1 },
    },
    { createTask: () => { throw new Error("unused"); } },
    { logEntry: () => {} },
  );

  const result = engine.run(`${process.execPath} -e "console.log('ok')"`);
  const intents = JSON.parse(readFileSync(join(rootDir, "workspace", "runtime-state", "execution-intents.json"), "utf-8"));

  assert.equal(result.passed, true);
  assert.equal(intents.length, 1);
  assert.equal(intents[0].kind, "reconcile");
  assert.equal(intents[0].status, "completed");
  assert.equal(intents[0].attempts, 1);
  assert.equal(intents[0].metadata.command, `${process.execPath} -e \"console.log('ok')\"`);
});

test("ReconcileEngine persists failed reconciliation intents", () => {
  const rootDir = mkdtempSync(join(tmpdir(), "agent-maestro-reconcile-"));
  mkdirSync(join(rootDir, "workspace", "runtime-state"), { recursive: true });
  const engine = new ReconcileEngine(
    rootDir,
    {
      paths: { workspace: "workspace" },
      limits: { max_reconcile_retries: 1 },
    },
    { createTask: () => { throw new Error("unused"); } },
    { logEntry: () => {} },
  );

  const result = engine.run(`${process.execPath} -e "process.exit(2)"`);
  const intents = JSON.parse(readFileSync(join(rootDir, "workspace", "runtime-state", "execution-intents.json"), "utf-8"));

  assert.equal(result.passed, false);
  assert.equal(intents.length, 1);
  assert.equal(intents[0].kind, "reconcile");
  assert.equal(intents[0].status, "failed");
  assert.equal(intents[0].attempts, 1);
  assert.equal(intents[0].lastError.code, undefined);
});
