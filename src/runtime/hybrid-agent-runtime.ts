/**
 * Hybrid runtime selector:
 * - Workers: container runtime
 * - Leads/Maestro: host runtime (tmux or process)
 */

import type {
  AgentRuntimeLaunchParams,
  AgentRuntimeResumeParams,
  RuntimeHandle,
  RuntimeResult,
} from "../types.js";
import type { AgentRuntime } from "./agent-runtime.js";

export class HybridAgentRuntime implements AgentRuntime {
  private hostRuntime: AgentRuntime;
  private workerRuntime: AgentRuntime;
  private maxConcurrent: number;
  private backends = new Map<string, AgentRuntime>();

  constructor(hostRuntime: AgentRuntime, workerRuntime: AgentRuntime, maxConcurrent: number) {
    this.hostRuntime = hostRuntime;
    this.workerRuntime = workerRuntime;
    this.maxConcurrent = maxConcurrent;
  }

  ensureReady(): void {
    this.hostRuntime.ensureReady();
    this.workerRuntime.ensureReady();
  }

  hasCapacity(): boolean {
    return this.backends.size < this.maxConcurrent;
  }

  launch(params: AgentRuntimeLaunchParams): RuntimeHandle {
    if (!this.hasCapacity()) {
      throw new Error(`Spawn budget exhausted: ${this.backends.size}/${this.maxConcurrent}`);
    }

    const backend = params.role === "worker" ? this.workerRuntime : this.hostRuntime;
    const handle = backend.launch(params);
    this.backends.set(handle.id, backend);
    return handle;
  }

  resume(handle: RuntimeHandle, params: AgentRuntimeResumeParams): void {
    this.backends.get(handle.id)?.resume(handle, params);
  }

  isAlive(handle: RuntimeHandle): boolean {
    return this.backends.get(handle.id)?.isAlive(handle) ?? false;
  }

  getOutput(handle: RuntimeHandle, lines?: number): string {
    return this.backends.get(handle.id)?.getOutput(handle, lines) ?? "";
  }

  interrupt(handle: RuntimeHandle, reason: string): void {
    this.backends.get(handle.id)?.interrupt(handle, reason);
  }

  destroy(handle: RuntimeHandle): void {
    const backend = this.backends.get(handle.id) ?? this.fallbackBackend(handle);
    backend?.destroy(handle);
    this.backends.delete(handle.id);
  }

  getResult(handle: RuntimeHandle): RuntimeResult | null {
    return this.backends.get(handle.id)?.getResult(handle) ?? null;
  }

  private fallbackBackend(handle: RuntimeHandle): AgentRuntime | null {
    if (handle.runtimeType === "container") {
      return this.workerRuntime;
    }

    if (handle.runtimeType === "tmux" || handle.runtimeType === "process" || handle.runtimeType === "dry-run") {
      return this.hostRuntime;
    }

    return null;
  }
}
