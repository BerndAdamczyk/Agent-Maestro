import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ActiveWorker,
  DelegationParams,
  ExecutionIntentKind,
  ExecutionIntentRecord,
  ExecutionIntentResult,
  ExecutionIntentStatus,
  ParsedTask,
  RuntimeEventEnvelope,
  RuntimeType,
} from "../types.js";
import { serializeError } from "../errors.js";
import { atomicWrite, formatTimestamp } from "../utils.js";
import { createRuntimeEventEnvelope } from "./contracts.js";

export class ExecutionIntentQueue {
  private queuePath: string;

  constructor(workspaceDir: string) {
    const runtimeStateDir = join(workspaceDir, "runtime-state");
    mkdirSync(runtimeStateDir, { recursive: true });
    this.queuePath = join(runtimeStateDir, "execution-intents.json");
  }

  list(): ExecutionIntentRecord[] {
    if (!existsSync(this.queuePath)) {
      return [];
    }

    try {
      return JSON.parse(readFileSync(this.queuePath, "utf-8")) as ExecutionIntentRecord[];
    } catch {
      return [];
    }
  }

  enqueueLaunch(params: DelegationParams, correlationId: string | null): ExecutionIntentRecord {
    return this.enqueueIntent({
      kind: "launch",
      taskId: params.taskId,
      correlationId,
      params,
      metadata: {
        phase: params.phase,
      },
      lifecycle: "launch_requested",
    });
  }

  enqueueCommandIntent(params: {
    kind: "reconcile" | "remediation";
    taskId: string;
    correlationId?: string | null;
    agentName?: string;
    command: string;
    note?: string;
  }): ExecutionIntentRecord {
    return this.enqueueIntent({
      kind: params.kind,
      taskId: params.taskId,
      correlationId: params.correlationId ?? null,
      params: this.syntheticParams(params.taskId, params.agentName ?? titleCase(params.kind)),
      metadata: {
        command: params.command,
        note: params.note ?? null,
      },
      lifecycle: "launch_requested",
    });
  }

  enqueueIntent(params: {
    kind: ExecutionIntentKind;
    taskId: string;
    correlationId: string | null;
    params: DelegationParams;
    metadata?: Record<string, unknown>;
    lifecycle: RuntimeEventEnvelope["lifecycle"];
  }): ExecutionIntentRecord {
    const dedupeKey = this.buildDedupeKey(params.kind, params.taskId);
    const queue = this.list();
    const now = formatTimestamp(new Date(), { includeMilliseconds: true });
    const existing = queue.find(intent => intent.dedupeKey === dedupeKey);

    if (existing) {
      existing.params = params.params;
      existing.correlationId = params.correlationId;
      existing.metadata = params.metadata ?? existing.metadata;
      existing.updatedAt = now;
      if (existing.status === "failed" || existing.status === "skipped") {
        existing.status = "pending";
        existing.result = null;
        existing.lastError = null;
      }
      this.write(queue);
      return existing;
    }

    const record: ExecutionIntentRecord = {
      id: randomUUID(),
      kind: params.kind,
      status: "pending",
      dedupeKey,
      taskId: params.taskId,
      correlationId: params.correlationId,
      params: params.params,
      metadata: params.metadata,
      createdAt: now,
      updatedAt: now,
      attempts: 0,
      lastError: null,
      result: null,
      events: [this.createQueueEvent(params.params, params.correlationId, params.lifecycle, params.kind, params.metadata)],
    };

    queue.push(record);
    this.write(queue);
    return record;
  }

  markInProgress(intentId: string, runtime: { runtimeId?: string | null; runtimeType?: RuntimeType | "unknown" } = {}): ExecutionIntentRecord | null {
    return this.transition(intentId, "in_progress", {
      attemptsDelta: 1,
      runtimeId: runtime.runtimeId ?? null,
      runtimeType: runtime.runtimeType ?? "unknown",
      lifecycle: "launch_started",
    });
  }

  markCompleted(intentId: string, result: ExecutionIntentResult): ExecutionIntentRecord | null {
    return this.transition(intentId, "completed", {
      runtimeId: result.runtimeId ?? null,
      runtimeType: result.runtimeType ?? "unknown",
      result,
      lifecycle: "running",
    });
  }

  markSkipped(intentId: string, note: string): ExecutionIntentRecord | null {
    return this.transition(intentId, "skipped", {
      result: { note },
      lifecycle: "replayed",
    });
  }

  markFailed(intentId: string, error: unknown): ExecutionIntentRecord | null {
    return this.transition(intentId, "failed", {
      lastError: serializeError(error),
      lifecycle: "failed",
    });
  }

  replayPendingLaunches(params: {
    tasks: Map<string, ParsedTask>;
    activeWorkers: Map<string, ActiveWorker>;
  }): DelegationParams[] {
    const queue = this.list();
    const replayable: DelegationParams[] = [];
    let dirty = false;

    for (const intent of queue) {
      if (intent.kind !== "launch") continue;
      if (intent.status !== "pending" && intent.status !== "in_progress") continue;

      const task = params.tasks.get(intent.taskId);
      if (!task) {
        intent.status = "failed";
        intent.updatedAt = formatTimestamp(new Date(), { includeMilliseconds: true });
        intent.lastError = {
          name: "MaestroError",
          message: `Task missing during launch replay: ${intent.taskId}`,
          code: "TASK_NOT_FOUND",
        };
        intent.events.push(this.createQueueEvent(intent.params, intent.correlationId, "failed", intent.kind, {
          ...intent.metadata,
          note: "task missing during replay",
        }));
        dirty = true;
        continue;
      }

      if (task.status === "complete" || task.status === "failed") {
        intent.status = "skipped";
        intent.updatedAt = formatTimestamp(new Date(), { includeMilliseconds: true });
        intent.result = { note: `Task already terminal during replay: ${task.status}` };
        intent.events.push(this.createQueueEvent(intent.params, intent.correlationId, "replayed", intent.kind, {
          ...intent.metadata,
          note: `task already ${task.status}`,
        }));
        dirty = true;
        continue;
      }

      if (params.activeWorkers.has(intent.taskId)) {
        intent.status = "skipped";
        intent.updatedAt = formatTimestamp(new Date(), { includeMilliseconds: true });
        intent.result = { note: "Active worker already exists during replay" };
        intent.events.push(this.createQueueEvent(intent.params, intent.correlationId, "replayed", intent.kind, {
          ...intent.metadata,
          note: "active worker already exists",
        }));
        dirty = true;
        continue;
      }

      intent.status = "pending";
      intent.updatedAt = formatTimestamp(new Date(), { includeMilliseconds: true });
      intent.events.push(this.createQueueEvent(intent.params, intent.correlationId, "replayed", intent.kind, {
        ...intent.metadata,
        note: "launch re-queued during replay",
      }));
      replayable.push(intent.params);
      dirty = true;
    }

    if (dirty) {
      this.write(queue);
    }

    return replayable;
  }

  private transition(
    intentId: string,
    status: ExecutionIntentStatus,
    options: {
      attemptsDelta?: number;
      runtimeId?: string | null;
      runtimeType?: RuntimeType | "unknown";
      lifecycle: RuntimeEventEnvelope["lifecycle"];
      result?: ExecutionIntentResult | null;
      lastError?: ExecutionIntentRecord["lastError"];
    },
  ): ExecutionIntentRecord | null {
    const queue = this.list();
    const intent = queue.find(candidate => candidate.id === intentId);
    if (!intent) return null;

    intent.status = status;
    intent.updatedAt = formatTimestamp(new Date(), { includeMilliseconds: true });
    intent.attempts += options.attemptsDelta ?? 0;
    intent.result = options.result ?? intent.result;
    intent.lastError = options.lastError ?? null;
    intent.events.push(this.createQueueEvent(intent.params, intent.correlationId, options.lifecycle, intent.kind, {
      ...intent.metadata,
      runtimeId: options.runtimeId ?? null,
      runtimeType: options.runtimeType ?? "unknown",
      status,
      note: options.result?.note,
      errorCode: options.lastError?.code,
    }));

    this.write(queue);
    return intent;
  }

  private buildDedupeKey(kind: ExecutionIntentKind, taskId: string): string {
    return `${kind}:${taskId}`;
  }

  private createQueueEvent(
    params: DelegationParams,
    correlationId: string | null,
    lifecycle: RuntimeEventEnvelope["lifecycle"],
    kind: ExecutionIntentKind,
    details: Record<string, unknown> = {},
  ): RuntimeEventEnvelope {
    return createRuntimeEventEnvelope({
      eventType: "queue.intent",
      lifecycle,
      taskId: params.taskId,
      correlationId,
      agentName: params.agentName,
      runtimeType: "unknown",
      runtimeId: null,
      details: {
        intentKind: kind,
        phase: params.phase,
        ...details,
      },
    });
  }

  private syntheticParams(taskId: string, agentName: string): DelegationParams {
    return {
      agentName,
      taskId,
      taskTitle: taskId,
      taskDescription: taskId,
      taskType: "system",
      acceptanceCriteria: [],
      phase: "none",
      wave: 0,
      dependencies: [],
      planFirst: false,
      timeBudget: 0,
      parentTaskId: null,
      delegationDepth: 0,
    };
  }

  private write(queue: ExecutionIntentRecord[]): void {
    atomicWrite(this.queuePath, JSON.stringify(queue, null, 2));
  }
}

function titleCase(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
