import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FileLockManager, LockConflictError } from "../dist/src/lock-manager.js";
import { atomicWrite } from "../dist/src/utils.js";

test("atomicWrite serializes writes and removes the lock file afterwards", () => {
  const dir = join(tmpdir(), `agent-maestro-lock-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, "status.md");

  atomicWrite(filePath, "hello\n");

  assert.equal(readFileSync(filePath, "utf-8"), "hello\n");
  assert.equal(existsSync(`${filePath}.lock`), false, "lock file should not remain");
});

test("FileLockManager cleans up stale locks before acquiring", () => {
  const dir = join(tmpdir(), `agent-maestro-stale-lock-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, "log.md");
  const lockPath = `${filePath}.lock`;

  writeFileSync(lockPath, JSON.stringify({
    schema_version: 1,
    token: "stale-token",
    pid: 999999,
    targetPath: filePath,
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() - 30_000).toISOString(),
  }), "utf-8");

  const manager = new FileLockManager();
  const handle = manager.acquire(filePath, { retries: 0, staleMs: 10 });
  manager.release(handle);

  assert.ok(handle.token);
});

test("FileLockManager reports contention for a live lock holder", () => {
  const dir = join(tmpdir(), `agent-maestro-contention-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, "tasks.md");
  const manager = new FileLockManager();
  const handle = manager.acquire(filePath, { retries: 0, staleMs: 60_000 });

  assert.throws(
    () => manager.acquire(filePath, { retries: 0, staleMs: 60_000 }),
    error => error instanceof LockConflictError && error.targetPath === filePath,
  );

  manager.release(handle);
});
