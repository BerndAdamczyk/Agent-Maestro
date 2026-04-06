/**
 * Agent runtime contract for delegated agent execution.
 * Reference: arc42 Section 5.2.1
 */

import type {
  AgentRuntimeLaunchParams,
  AgentRuntimeResumeParams,
  RuntimeHandle,
  RuntimeResult,
} from "../types.js";

export interface AgentRuntime {
  ensureReady(): void;
  hasCapacity(): boolean;
  launch(params: AgentRuntimeLaunchParams): RuntimeHandle;
  resume(handle: RuntimeHandle, params: AgentRuntimeResumeParams): void;
  isAlive(handle: RuntimeHandle): boolean;
  getOutput(handle: RuntimeHandle, lines?: number): string;
  interrupt(handle: RuntimeHandle, reason: string): void;
  destroy(handle: RuntimeHandle): void;
  getResult(handle: RuntimeHandle): RuntimeResult | null;
}
