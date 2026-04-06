# Implementation Considerations

Last updated: 2026-04-06

## Current decisions

| Area | Status | Decision | Owner |
|------|--------|----------|-------|
| P0 secret redaction pipeline | Implemented | Centralized redaction in `src/security.ts`; logger persistence, prompt snapshots, and file-watcher payloads now pass through the same redaction layer before they are written or broadcast. | Platform / Security |
| P0 prompt injection sanitizer | Implemented | Workspace-derived prompt context is now structurally delimited as untrusted content, has prompt-like role syntax neutralized, and is quoted line-by-line before prompt inclusion. | Platform / Security |
| P1 `AgentRuntime` contract | Implemented | Introduced a runtime interface in `src/runtime/agent-runtime.ts`; execution is now Pi-backed and launch inputs include model, role, prompt/session/policy paths, with runtime selection delegated to a hybrid host/container implementation. | Runtime |
| P1 tmux integration strategy | Implemented | Keep `src/runtime-manager.ts` as the low-level tmux primitive layer; orchestration code now depends on `AgentRuntime` instead of the tmux manager directly. | Runtime |
| P1 plan-gate runtime state machine | Implemented | The orchestrator now treats `plan_ready` as a paused turn, consumes `plan_approved` / `plan_revision_needed` as control-plane signals, and resumes workers via `AgentRuntime.resume()` in the correct phase. | Runtime / Workflow |
| P1 handoff validation | Implemented | Handoff reports now carry validation metadata in task files and pass a schema-plus-semantic validation step before completion is accepted; invalid handoffs are resumed back into execution for revision. | Validation |
| P2 enhanced logger | Implemented | Activity logging now carries `level`, `taskId`, and `correlationId`, with a redacted `workspace/log.jsonl` sidecar for machine-readable audit/recovery flows. | Observability |
| P2 pane/process health check | Implemented | tmux pane health now verifies the underlying process PID instead of assuming a visible pane implies a live worker; `/api/health` and `/api/tmux/panes` expose unhealthy pane counts. | Runtime / Observability |
| P2 no-tmux degradation | Implemented | `PlainProcessAgentRuntime` now provides a `child_process.spawn` fallback with output capture and redacted per-agent log persistence when tmux is unavailable. | Runtime |
| Worker container isolation | Implemented | Worker agents now launch through `ContainerAgentRuntime`, which builds or reuses a dedicated Pi image, mounts the repository read-only by default, overlays only authority-approved roots as read-write, and applies CPU/memory/pid/security limits per container. | Runtime / Security |
| Tool and file authority enforcement | Implemented | Every delegated task now emits a runtime policy manifest consumed by a Pi extension in `.pi/extensions/maestro-policy.ts`; file tools are path-checked against frontmatter `domain` rules, denials are logged, and bash turns are guarded in addition to filesystem mount isolation. | Runtime / Security |
| P2 Express baseline / wave cycle detection | Implemented | Express is pinned to the 4.21.x line per the architecture doc; `computeWaves()` already enforced cycle detection and remains unchanged. | Platform |
| P2 stall / timeout ladder | Implemented | Stalled workers now transition to `stalled`, receive a runtime nudge, recover back to `in_progress` on new output, and escalate to interruption/failure when the configured timeout ladder is exceeded. | Runtime / Monitoring |
| Deterministic wave execution | Implemented | `workspace/plan.md` is now parsed as the authoritative `TaskPlan`; when absent, the Maestro requests strict JSON decomposition through Pi, validates the task graph, computes waves deterministically, materializes all tasks up front, and executes wave-by-wave with resume-aware relaunch and reconciliation hooks. | Runtime / Workflow |
| Memory promotion / daily protocol flush | Implemented | Task lifecycle events now append to the Session DAG and promote validated task outcomes into Level 2 daily protocols on completion/failure before Git memory checkpoints are attempted. | Memory / Runtime |

## Follow-up notes

- Use `AgentRuntime.resume()` as the single control-plane entry point for plan approval, revision, and future operator interventions.
- Keep prompt audit files redacted by construction; do not add alternate prompt persistence paths that bypass `PromptAssembler`.
- If additional persistence sinks are introduced (`logs/*.log`, JSONL events, runtime stdout capture), route them through `redactSecrets()` before writing to disk.
