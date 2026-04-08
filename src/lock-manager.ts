/**
 * Advisory file locking for shared coordination artifacts.
 * Reference: arc42 Section 8.11 (file-level locking target)
 */

import { closeSync, openSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";

export interface FileLockOptions {
  staleMs?: number;
  retries?: number;
  retryDelayMs?: number;
}

export interface FileLockHandle {
  lockPath: string;
  token: string;
}

interface LockPayload {
  schema_version: 1;
  token: string;
  pid: number;
  targetPath: string;
  createdAt: string;
  expiresAt: string;
}

const DEFAULT_STALE_MS = 30_000;
const DEFAULT_RETRIES = 4;
const DEFAULT_RETRY_DELAY_MS = 25;

export class LockConflictError extends Error {
  readonly targetPath: string;
  readonly lockPath: string;

  constructor(targetPath: string, lockPath: string, message?: string) {
    super(message ?? `File is locked: ${targetPath}`);
    this.name = "LockConflictError";
    this.targetPath = targetPath;
    this.lockPath = lockPath;
  }
}

export class FileLockManager {
  acquire(targetPath: string, options: FileLockOptions = {}): FileLockHandle {
    const retries = options.retries ?? DEFAULT_RETRIES;
    const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const handle = this.tryAcquire(targetPath, options);
      if (handle) {
        return handle;
      }

      if (attempt < retries) {
        sleep(retryDelayMs * (attempt + 1));
      }
    }

    throw new LockConflictError(targetPath, lockPathFor(targetPath), `Timed out waiting for file lock: ${targetPath}`);
  }

  release(handle: FileLockHandle): void {
    try {
      const payload = readLockPayload(handle.lockPath);
      if (payload?.token && payload.token !== handle.token) {
        return;
      }
      unlinkSync(handle.lockPath);
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
    }
  }

  withLock<T>(targetPath: string, fn: () => T, options: FileLockOptions = {}): T {
    const handle = this.acquire(targetPath, options);
    try {
      return fn();
    } finally {
      this.release(handle);
    }
  }

  private tryAcquire(targetPath: string, options: FileLockOptions): FileLockHandle | null {
    const lockPath = lockPathFor(targetPath);
    const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
    const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const now = Date.now();
    const payload: LockPayload = {
      schema_version: 1,
      token,
      pid: process.pid,
      targetPath,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + staleMs).toISOString(),
    };

    try {
      const fd = openSync(lockPath, "wx");
      try {
        writeFileSync(fd, JSON.stringify(payload, null, 2), "utf-8");
      } finally {
        closeSync(fd);
      }
      return { lockPath, token };
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }
    }

    if (this.cleanupStaleLock(lockPath, staleMs)) {
      return this.tryAcquire(targetPath, options);
    }

    return null;
  }

  private cleanupStaleLock(lockPath: string, staleMs: number): boolean {
    const payload = readLockPayload(lockPath);
    const now = Date.now();
    const lockStat = safeStat(lockPath);
    const expiredByLease = payload?.expiresAt ? Date.parse(payload.expiresAt) <= now : false;
    const expiredByAge = !!lockStat && now - lockStat.mtimeMs > staleMs;
    const ownerDead = payload?.pid ? !isProcessAlive(payload.pid) : false;
    const shouldRemove = expiredByLease || expiredByAge || ownerDead;

    if (!shouldRemove) {
      return false;
    }

    try {
      rmSync(lockPath, { force: true });
      return true;
    } catch (error) {
      if (isMissingFileError(error)) {
        return true;
      }
      throw error;
    }
  }
}

const defaultLockManager = new FileLockManager();

export function withFileLock<T>(targetPath: string, fn: () => T, options: FileLockOptions = {}): T {
  return defaultLockManager.withLock(targetPath, fn, options);
}

export function acquireFileLock(targetPath: string, options: FileLockOptions = {}): FileLockHandle {
  return defaultLockManager.acquire(targetPath, options);
}

export function releaseFileLock(handle: FileLockHandle): void {
  defaultLockManager.release(handle);
}

function lockPathFor(targetPath: string): string {
  return `${targetPath}.lock`;
}

function readLockPayload(lockPath: string): LockPayload | null {
  try {
    return JSON.parse(readFileSync(lockPath, "utf-8")) as LockPayload;
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    return null;
  }
}

function safeStat(path: string) {
  try {
    return statSync(path);
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
