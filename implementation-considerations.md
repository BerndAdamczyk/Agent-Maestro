# Implementation Considerations

Last updated: 2026-04-06

## Current decisions

| Area | Status | Decision | Owner |
|------|--------|----------|-------|
| P0 secret redaction pipeline | Implemented | Centralized redaction in `src/security.ts`; logger persistence, prompt snapshots, and file-watcher payloads now pass through the same redaction layer before they are written or broadcast. | Platform / Security |
| P0 prompt injection sanitizer | Implemented | Workspace-derived prompt context is now structurally delimited as untrusted content, has prompt-like role syntax neutralized, and is quoted line-by-line before prompt inclusion. | Platform / Security |
| P1 `AgentRuntime` contract | Implemented | Introduced a runtime interface in `src/runtime/agent-runtime.ts`, with `TmuxAgentRuntime` as the default backend and `DryRunAgentRuntime` as a selectable backend via `MAESTRO_RUNTIME=dry-run`. | Runtime |
| P1 tmux integration strategy | Implemented | Keep `src/runtime-manager.ts` as the low-level tmux primitive layer; orchestration code now depends on `AgentRuntime` instead of the tmux manager directly. | Runtime |
| P1 plan-gate runtime state machine | Implemented | The orchestrator now treats `plan_ready` as a paused turn, consumes `plan_approved` / `plan_revision_needed` as control-plane signals, and resumes workers via `AgentRuntime.resume()` in the correct phase. | Runtime / Workflow |
| P1 handoff validation | Implemented | Handoff reports now carry validation metadata in task files and pass a schema-plus-semantic validation step before completion is accepted; invalid handoffs are resumed back into execution for revision. | Validation |
| P2 enhanced logger | Pending | If JSONL sidecar is added, keep `src/security.ts` as the single redaction hook instead of duplicating masking logic in multiple sinks. | Observability |
| P2 no-tmux degradation | Pending | `DryRunAgentRuntime` is for control-plane testing only; the real non-tmux fallback should be a child-process runtime with output capture and compatible lifecycle semantics. | Runtime |

## Follow-up notes

- Use `AgentRuntime.resume()` as the single control-plane entry point for plan approval, revision, and future operator interventions.
- Keep prompt audit files redacted by construction; do not add alternate prompt persistence paths that bypass `PromptAssembler`.
- If additional persistence sinks are introduced (`logs/*.log`, JSONL events, runtime stdout capture), route them through `redactSecrets()` before writing to disk.
