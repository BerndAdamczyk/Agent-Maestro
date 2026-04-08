import { randomUUID } from "node:crypto";
import type {
  RuntimeEventEnvelope,
  RuntimeLifecycleState,
  RuntimeResult,
  RuntimeType,
} from "../types.js";

export function createRuntimeEventEnvelope(params: {
  eventType?: RuntimeEventEnvelope["eventType"];
  lifecycle: RuntimeLifecycleState;
  taskId: string;
  correlationId?: string | null;
  agentName: string;
  runtimeType?: RuntimeType | "unknown";
  runtimeId?: string | null;
  details?: Record<string, unknown>;
  timestamp?: string;
}): RuntimeEventEnvelope {
  return {
    id: randomUUID(),
    timestamp: params.timestamp ?? new Date().toISOString(),
    eventType: params.eventType ?? "runtime.lifecycle",
    lifecycle: params.lifecycle,
    taskId: params.taskId,
    correlationId: params.correlationId ?? null,
    agentName: params.agentName,
    runtimeType: params.runtimeType ?? "unknown",
    runtimeId: params.runtimeId ?? null,
    details: params.details,
  };
}

export function appendRuntimeLifecycleEvent(
  result: RuntimeResult,
  event: RuntimeEventEnvelope,
): RuntimeResult {
  const lifecycleEvents = [...(result.lifecycleEvents ?? []), event].slice(-25);
  return {
    ...result,
    lifecycleState: event.lifecycle,
    lastLifecycleEvent: event,
    lifecycleEvents,
  };
}
