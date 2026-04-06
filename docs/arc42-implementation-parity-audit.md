# Agent Maestro arc42 Implementation Parity Audit

Date: 2026-04-06

Scope: comparison of the current repository state against `docs/arc42-architecture.md`.

Verification performed:
- Read `docs/arc42-architecture.md` end to end.
- Inspected all implementation areas referenced by the document: `src/`, `src/runtime/`, `src/memory/`, `web/server/`, `web/client/`, `agents/`, `skills/`, `multi-team-config.yaml`, `run.sh`, `docker/worker-runtime.Dockerfile`, `.pi/extensions/maestro-policy.ts`.
- Confirmed the codebase still builds and type-checks with `npm run build` and `npm run lint`.

Status legend:
- `Aligned`: materially matches the document.
- `Partial`: implemented, but weaker or narrower than documented.
- `Missing`: described as current in the document, but not implemented.
- `Doc stale`: the document references files/components/behavior that no longer match the repository.

## Highest-impact findings

1. Recursive hierarchical delegation is not implemented as documented. The system is a centralized deterministic orchestrator, but delegated agents do not receive runnable `delegate`, `update_memory`, or `query_notebooklm` tools. Runtime tool exposure is limited to `read`, `write`, `edit`, and `bash` (`src/delegation-engine.ts:228-232`), and hierarchy resolution is hard-coded to levels 1/2/3 (`src/config.ts:194-215`).
2. The "runtime-enforced" plan-approval gate is only partially true. The orchestrator does split work into separate turns and resume phases, but phase 1 does not reduce write authority; the runtime policy manifest includes `phase`, yet the Pi policy extension never uses it. A phase-1 worker can still modify repo files if it ignores prompt instructions (`src/runtime/policy.ts`, `.pi/extensions/maestro-policy.ts:9-20`, `.pi/extensions/maestro-policy.ts:156-179`).
3. The 4-level memory system is only partially implemented. Level 1 exists, Level 2 is only used on task terminal states, Level 3 append methods exist but are unused and structurally weak, and Level 4 is read-only in practice. Silent flush, L2->L3 promotion, L3->L4 distillation, and memory-training flows are not implemented.
4. Session recovery/resume is much weaker than the document claims. `--resume` only recalculates completed waves from task files; it does not reconstruct active workers or runtime handles (`src/main.ts:154-167`). In-progress tasks can be re-launched as duplicates after resume.
5. Security and isolation are overstated for host runtimes. Domain path enforcement exists for Pi file tools, but host-runtime `bash` commands are not path-aware; they can modify files outside `domain.upsert` on tmux/plain-process backends. The container backend is meaningfully safer because mount layout limits writes, but the host backends are not.
6. The web/component diagrams are stale in multiple places. The document names components and routes that do not exist (`src/maestro.ts`, `web/server/routes/notebooklm.ts`, `task-parser.ts`, `config-parser.ts`, `markdown-table.ts`, `/api/memory`), while the actual server is defined by `web/server/index.ts` and the current route files.
7. Model tiering and provider failover are only partially implemented. Planning uses curator primary/fallback models (`src/task-plan-provider.ts:25-74`), but agent launches use the concrete `model` from frontmatter directly (`src/delegation-engine.ts:143-160`), so `model_tier_policy` is not the authoritative runtime resolver for workers/leads.
8. Deployment/runtime claims overstate the container implementation. The worker image is built lazily, not prebuilt (`src/runtime/container-agent-runtime.ts:49-65`), uses `node:20` rather than the documented Node 22 baseline (`docker/worker-runtime.Dockerfile`), and does not enforce bounded disk or outbound-HTTPS-only networking.

## 1. Introduction and Goals

- `1.1 Business Context` — `Partial`. Local-first execution, deterministic orchestration, task delegation, monitoring, and file-based state are real. The documented "unlimited-depth, tree-structured hierarchy" is not: config and resolver logic only understand Maestro, team leads, and workers (`src/types.ts:114-140`, `src/config.ts:158-215`), and delegated agents cannot recursively spawn sub-agents because `delegate` is not exposed as a runtime tool (`src/delegation-engine.ts:228-232`).
- `1.2 Business Goals` — `Partial`. Goal 1 is only partially met because delegation is centralized rather than recursive. Goal 2 is only partially met because persistent learning stops effectively at Level 2 daily protocols. Goal 3 is still target-only. Goal 4 is partially met because logs, task state, and handoff validation exist, but evidence-gated execution, gamification, and complete traceability do not.
- `1.3 Quality Goals` — `Partial`. Reliability and observability have real foundations. Extensibility, resilience, and security are weaker than documented because plugin slots are absent, resume/recovery is weak, and host-runtime authority boundaries are incomplete.
- `1.4 Stakeholders` — `Partial`. Developer, Maestro, leads, and workers are represented in code/config. LLM providers and NotebookLM are not first-class integrations in this repo; provider access is delegated to the external `pi` CLI, and NotebookLM has no implementation beyond frontmatter flags and a skill document.

## 2. Constraints

- `2.1 Technical Constraints` — `Partial`. Node 22+, Express 4.21.x, deterministic TypeScript orchestration, file-based coordination, and a Pi-backed runtime abstraction are implemented. The plain-process fallback is not end-to-end because `run.sh` hard-requires tmux to start/resume sessions (`run.sh:56-75`). Pi is also an external CLI dependency rather than a declared project dependency.
- `2.2 Organizational Constraints` — `Aligned`. The repo is built for single-user local operation and does not contain a persistent DB. SQLite-backed scoring/training remains target-only.
- `2.3 Convention Constraints` — `Partial`. Frontmatter-based agents, plan precedence, and four-section handoff structure exist. Shared-state durability is only partially true: `plan.md` and `status.md` use atomic writes, but `log.md` and task files are written directly (`src/utils.ts`, `src/logger.ts`, `src/task-manager.ts:148-150`). The document's "lead-level acceptance gate" is currently a heuristic validator, not a lead review workflow.

## 3. Context and Scope

- `3.1 System Context` — `Partial`. Developer, local file system, tmux/container runtime, and Git memory checkpoints are real. NotebookLM is missing. Git/GitHub integration is far narrower than the diagram suggests. Direct provider/OAuth integration is not implemented in-repo; model execution is delegated to the external `pi` binary.
- `3.2 Business Context` — `Partial`. HTTP/WS/CLI interactions exist. Local file and tmux/container protocols exist. The documented provider protocols are not implemented as repo-owned clients; no Google Gemini or Anthropic ACP adapter exists here.

## 4. Solution Strategy

- `Decision 1 — Unlimited-depth hierarchical delegation` — `Missing`. Current config schema is fixed to Maestro -> team lead -> workers (`src/types.ts:114-140`), hierarchy lookup is fixed to levels 1/2/3 (`src/config.ts:194-215`), and agents do not get a usable `delegate` runtime tool (`src/delegation-engine.ts:228-232`).
- `Decision 2 — File-based coordination` — `Aligned`. Workspace files are the canonical coordination state and are used throughout the implementation.
- `Decision 3 — Deterministic Maestro + Pi runtime contract` — `Partial`. The control plane is deterministic and Pi-backed runtimes exist. The contract described in the doc is stale relative to the actual `AgentRuntimeLaunchParams`, and runtime results are largely placeholder data not consumed by orchestration.
- `Decision 4 — Tiered process isolation` — `Partial`. Hybrid host/container runtime selection exists (`src/main.ts:419-457`, `src/runtime/hybrid-agent-runtime.ts`), but the CLI path still requires tmux, host-runtime bash is not authority-safe, and deployment guarantees are weaker than documented.
- `Decision 5 — Deterministic wave scheduling` — `Aligned`. Wave computation and stable ordering are implemented (`src/task-plan.ts`, `src/wave-scheduler.ts`).
- `Decision 6 — Runtime-enforced quality gates` — `Partial`. Turn-based plan gating and handoff validation exist, but phase-1 execution is not technically prevented by authority reduction, and the handoff gate is automated heuristic validation rather than lead acceptance.
- `Decision 7 — 4-level memory system` — `Partial`. All named components exist, but the actual upward promotion flow is incomplete and several responsibilities are only scaffolding.
- `Decision 8 — Plugin-slot architecture` — `Missing`. Only the runtime abstraction exists; the broader six-slot plugin architecture is not present.
- `Decision 9 — Reflection-based training` — `Missing`. No training pipeline, reflection summaries, or L3 updates are triggered automatically.
- `Decision 10 — Evidence-gated gamification` — `Missing`. No XP ledger, evidence model, or anti-gaming implementation exists.
- `Decision 11 — Layered fault tolerance` — `Partial`. Timeouts, stall nudges, and runtime abstraction exist. Provider failover for agent execution, strong session recovery, and bounded retry classification do not.
- `Decision 12 — Resource-aware backpressure` — `Partial`. Spawn budget and queueing exist. Provider-rate backpressure and richer resource controls do not.
- `Decision 13 — Context window budgeting` — `Partial`. There is simple truncation and context isolation by prompt assembly, but no provider-aware token counting, no progressive skill disclosure, and no expertise pruning/archival.

## 5. Building Block View

- `5.1 Container Diagram` — `Partial`. Core runtime, memory facade, web server, file watcher, web client, workspace, agent registry, skill library, and Git checkpointing exist. Training pipeline, score service, meta-agent service, and plugin registry remain absent as expected. Doc issue: the container names are directionally correct, but the concrete source references are stale.
- `5.2.1 Maestro Runtime Components` — `Partial`. Config loader, agent resolver, prompt assembler, delegation engine, monitoring, reconciliation, task manager, logger, and active-worker tracking exist across `src/main.ts`, `src/orchestration-engine.ts`, and companion modules. Missing pieces: NotebookLM client, real agent-side delegation tools, and a distinct context-injector component. Doc issue: source is not `src/maestro.ts`; that file does not exist.
- `5.2.1 Runtime Contract` — `Partial`. `AgentRuntime` supports launch/resume/isAlive/getOutput/interrupt/destroy/getResult (`src/runtime/agent-runtime.ts`). The actual launch contract is wider than the doc says (`src/types.ts:223-243`), `handoffReportPath` is just the task file path in every runtime, and token/failover metrics stay null/zero.
- `5.2.2 Memory Subsystem Components` — `Partial`. All named classes exist (`src/memory/`). Gaps: `SessionDAGManager.rewind()` is not used anywhere; `DailyProtocolFlusher.flush()` is only called on terminal task outcomes, not at `pre_compaction`; `ExpertiseStore` append methods are unused; `GitCheckpointEngine` branch methods are unused; `MemoryAccessControl` denials are not logged.
- `5.2.2 Daily Protocol Structure` — `Low quality`. The doc describes categorized appends into Findings / Error Patterns / Decisions. The implementation appends bullets at file end without inserting them under those headings (`src/memory/daily-protocol.ts:50-68`).
- `5.2.2 Expertise Store Structure` — `Low quality`. The doc describes section-aware append-only `MEMORY.md` / `EXPERT.md`. The implementation ignores the requested target section and appends bullets to EOF (`src/memory/expertise-store.ts:95-147`).
- `5.2.3 Web Server Components` — `Partial`. Express app, WS handler, file watcher, and tmux service exist. Doc issue: `notebooklm.ts`, `task-parser.ts`, `config-parser.ts`, `markdown-table.ts`, and the referenced `LogEvent` implementation do not exist in the repository. The actual route set is defined in `web/server/index.ts:52-59`.
- `5.2.4 Agent Hierarchy` — `Partial`. The shipped default 3-level team structure matches config. The documented "Backend Dev as Level 3 Team-Lead" is false in the current repo: `agents/workers/backend-dev.md` has `delegate: false`, and the config has no nested sub-team capability.
- `5.2.5 Target Plugin Architecture` — `Missing`. No six-slot registry or loader exists.
- `5.3 Code Level` — `Partial`. Many types exist in `src/types.ts`, but several doc-listed types do not: `ProviderConfig`, `ContainerPolicy`, and `LogEvent` are absent. Doc issue: many locations still point to `src/maestro.ts`, which no longer exists.

## 6. Runtime View

- `6.1 Full Delegation Flow` — `Partial`. Goal -> plan -> wave computation -> delegation -> monitoring -> reconciliation is implemented. The recursive sub-delegation sequence shown in the document is not: leads do not delegate to workers through a runtime tool; the central orchestrator launches all planned tasks.
- `6.2 Plan-Approval Gate` — `Partial`. The two-phase protocol exists in task status/phase handling (`src/task-manager.ts`, `src/main.ts:491-518`). It is not fully runtime-enforced because phase 1 does not reduce write authority; the extension ignores `phase`, and the same file tools remain enabled.
- `6.3 Reconciliation Loop` — `Aligned`. Validation commands are executed between waves and fix tasks are auto-created on failure (`src/orchestration-engine.ts:215-273`, `src/reconcile-engine.ts`).
- `6.4 Real-time UI Update Flow and Chat-like Delegation View` — `Partial`. The chat-like UI exists and renders log entries, handoffs, and plan approvals. Pane output is not actually rendered in the client even though the WebSocket server can send it (`web/client/index.html` ignores `pane:output`). File watcher events also do not include parsed task/log payloads as documented (`web/server/services/file-watcher.ts:64-69`).
- `6.5 Training Pipeline` — `Missing`. No implementation.
- `6.6 Wave-Based Parallel Execution` — `Aligned`. Stable topological sort with cycle detection is implemented. Minor gap: cycle errors identify a single task involved rather than a full cycle path.
- `6.7 Session DAG Branching and Rewind` — `Missing`. The manager supports branch/rewind mechanically, but orchestration/runtime never uses it.
- `6.8 Silent Memory Flush` — `Missing`. There is no `pre_compaction` hook, no 80% token threshold handling, no NO_REPLY sentinel, and no flush-before-compaction behavior. Daily protocol writes only happen on task completion/failure (`src/main.ts:561-565`).

## 7. Deployment View

- `Section 7 overall` — `Partial`. Single-machine operation, port 3000 web server, tmux host runtime, and Docker worker runtime are real. The document overstates several deployment details: workers use an image built on demand rather than a prebuilt image (`src/runtime/container-agent-runtime.ts:49-65`), the image is based on Node 20 (`docker/worker-runtime.Dockerfile`), disk quotas are not configured, and the fallback path is not fully available from `run.sh`.
- `Infrastructure Decisions table` — `Partial`. Express 4.21.x, WebSocket, Chokidar, and file-based memory are aligned. `AgentRuntime` exists, but branch-per-worker memory isolation and rootless/prebuilt container guarantees are not currently true in practice.

## 8. Cross-cutting Concepts

- `8.1 File-based Coordination Protocol` — `Partial`. The coordination files are real, and `status.md` is rebuilt by the Maestro as sole writer. The document's atomic-write statement is only partially true because `log.md` and task files are direct writes.
- `8.2 Agent Identity and Prompt Assembly` — `Partial`. Prompt assembly does load agent body, L3 memory, L4 knowledge graph, skills, shared context, task data, and plan-phase instructions. Gaps: no task/log shared-context injection beyond goal/plan/status, no provider-aware token counting, and knowledge graph selection is by file-name keyword match rather than node metadata (`src/memory/knowledge-graph.ts:63-108`).
- `8.3 Skill Injection (Progressive Disclosure)` — `Missing`. The implementation loads every listed skill in full (`src/prompt-assembler.ts:63-70`). There is no metadata-tag filtering or task-relevance subset selection.
- `8.4 4-Level Agent Memory System` — `Partial`. L1 session JSONL files exist. L2 daily protocols exist but only receive terminal-task summaries. L3/L4 promotion and curation flows are absent. Access-control enforcement only applies when `ExpertiseStore` methods are called, and those methods are not part of runtime tooling.
- `8.5 Security, Isolation, and Input Sanitization` — `Partial`. Prompt redaction, untrusted workspace delimiting, Pi tool path restrictions, some bash blocking, container mounts, and localhost binding are real. Major gaps: no web auth/session tokens/rate limiting despite the section claiming they exist, no phase-aware authority reduction, and host-runtime bash is not path-sandboxed. Doc issue: this section conflicts with technical debt D3, which correctly says web auth is not implemented.
- `8.6 Observability` — `Partial`. `workspace/log.md`, `workspace/log.jsonl`, per-agent log files, WS file-change broadcasts, and tmux-pane capture all exist. Missing or weaker than documented: no structured event bus beyond the JSONL sidecar, no correlation-aware UI filtering, and no pane output rendering in the client.
- `8.7 Agent Lifecycle State Machine` — `Partial`. Practical states exist via task status and monitor logic. The documented `Flushing`, `MemoryPromotion`, and `Reflecting` lifecycle stages are not first-class runtime states, and the monitor does not consume `RuntimeResult` as a meaningful parallel signal.
- `8.8 Timeout, Deadlock Detection, and Stall Recovery` — `Partial`. Stall detection, task timeout, wave timeout, max depth, and spawn budget exist. Missing: retry bookkeeping per `(taskId, errorType)`, automatic reassign, and provider-level retry/failover for agent execution.
- `8.9 Resource Management and Backpressure` — `Partial`. Runtime slot backpressure and a simple FIFO queue are implemented. LLM token-bucket throttling, provider backoff orchestration for general agent execution, and disk retention controls are not.
- `8.10 Context Window Management` — `Partial`. There is simple truncation for memory/plan/status and isolated prompts per sub-agent. Missing: provider-aware counting, progressive skill disclosure, expertise archival/pruning, and a hard authoritative prompt budget.
- `8.11 Concurrent File Access and Conflict Resolution` — `Partial`. `status.md` single-writer behavior is real. The document overstates path-safety because bash can bypass path restrictions on host backends. No advisory locking exists, and task files are multi-writer in practice through worker writes, developer approval/revision actions, and validator updates.
- `8.12 Error Recovery and Resilience` — `Partial`. Runtime abstraction, stall escalation, and reconcile fix-tasks exist. Resume/session recovery is weak, provider failover is incomplete, and `run.sh` still depends on tmux. There is no write-ahead task queue.
- `8.13 Chat-like Visualization of Agent Communication` — `Partial`. The UI renders delegations, status changes, handoffs, plan approval cards, role badges, and team colors. Missing: memory update messages, monitoring check-ins, true thread/subtree drill-down, and live terminal embedding.
- `8.14 Domain Model` — `Partial`. Many concepts are represented as TS types (`AgentDefinition`, `ParsedTask`, `SessionState`, memory entry types). Several domain entities from the diagram are not implemented as actual model objects or persisted state: `TRAINING_RUN`, `XP_EVENT`, `WORKSPACE_STATE`, and a concrete knowledge-graph node model beyond a type.
- `8.15 Configuration Management and Model Tiering` — `Partial`. Layered config exists and several validations are implemented. Missing validations from the doc: circular team references, model identifier recognition, model-tier consistency with agent role, and "delegate implies at least one sub-agent". Most importantly, normal agent launches do not resolve the concrete model through `model_tier_policy`; they use frontmatter `model` directly (`src/delegation-engine.ts:143-160`).
- `8.16 Logging and Audit Trail` — `Partial`. Activity log, task handoffs, prompt snapshots, session DAGs, daily protocols, and per-agent logs exist. Correlation IDs do not appear in runtime log lines, and there is no structured event stream or retention management for per-agent logs.
- `8.17 Git-Memory Integration` — `Partial`. `mem:` commits and wave checkpoints exist. Branch-per-worker isolation and merge-on-completion are not used anywhere, so the document overstates Git-memory maturity.
- `8.18 Memory Best Practices` — `Partial`. Incremental append behavior exists in spirit, but section-aware updates are weak. Silent flush, memory observability, confidence-based pruning, and real model-tier-based curation flows are absent.
- `8.19 Gamification` — `Missing`. No implementation.

## 9. Architecture Decisions

- `ADR-001 File-based Coordination` — `Aligned`. The implementation matches this ADR well.
- `ADR-002 Tiered Process Isolation` — `Partial`. Hybrid runtimes exist, but the CLI still assumes tmux and the documented deployment guarantees are stronger than the actual implementation.
- `ADR-003 Unlimited-Depth Recursive Tree` — `Missing`. The current config/runtime is fixed to a 3-level shape.
- `ADR-004 Append-only Mental Models` — `Partial`. Append-style helpers exist, but they are not connected to runtime tools or promotion flows, and they do not preserve section structure.
- `ADR-005 Plugin-Slot Architecture` — `Missing`. Only runtime abstraction exists.
- `ADR-006 Wave-based Scheduling` — `Aligned`. This is one of the strongest areas of parity.
- `ADR-007 LLM Provider Abstraction with Failover Chain` — `Partial`. Planning has a simple curator primary/fallback attempt loop. General agent execution does not.
- `ADR-008 4-Level Memory System` — `Partial`. The component scaffolding exists, but the full flow does not.

## 10. Quality Requirements

- `10.1 Quality Tree` — `Partial`. The quality tree is a good target description, but the implementation does not currently satisfy several branches, especially extensibility, resilience, and security.
- `QS-01` — `Partial`. Normal completed tasks are cleaned up, but shutdown does not actively destroy in-flight workers before exit (`src/main.ts:375-397`).
- `QS-02` — `Aligned`. Reconciliation and fix-task looping are implemented.
- `QS-03` — `Partial`. Adding a new worker in the current 3-level structure is easy. Adding a deeper hierarchy without code changes is not.
- `QS-04` — `Aligned`. Adding a new skill file and referencing it from frontmatter is supported.
- `QS-05` — `Partial`. Correlation IDs exist in task files and activity logs, but they do not propagate through all runtime observations and UI drill-downs.
- `QS-06` — `Partial`. File-change broadcasts exist and are likely fast enough locally, but the UI often refetches full datasets rather than consuming parsed events directly.
- `QS-07` — `Partial`. Workspace state survives, but active-worker reconstruction is not implemented.
- `QS-08` — `Missing`. Provider failover for normal agent execution is not implemented in this repo.
- `QS-09` — `Missing` on host runtimes, `Partial` on container runtime. Pi file tools are restricted, but host-runtime bash can still mutate out-of-domain paths.
- `QS-10` — `Partial`. Prompt/user separation and sanitization exist, but the repo does not demonstrate a complete end-to-end prompt-injection hardening story for all execution paths.
- `QS-11` — `Missing`. The phase-1 plan gate does not technically prevent file changes before approval.
- `QS-12` — `Aligned` for schema completeness, `Partial` for semantics. Incomplete handoff structure is rejected, but the gate is heuristic, not a real lead semantic review.
- `QS-13` — `Partial`. Logs, prompt snapshots, runtime logs, and file-watcher content are redacted. Task files/handoffs are not redacted by any generic persistence layer.
- `QS-14` — `Not guaranteed`. No spawn-performance instrumentation exists, and container image bootstrap can be far slower than the stated target on first run.
- `QS-15` — `Missing`. There is no authoritative token budget enforcement for complete prompts.

## 11. Risks and Technical Debt

- `11.1 Risks` — `Partial`. The risk list is directionally correct. Several mitigations are overstated: provider failover, prompt-injection hardening, and concurrent write control are weaker than written.
- `11.2 Technical Debt` — `Mixed`. `D2` and `D5` are still valid. `D3` is still valid and directly contradicts section 8.5. `D4` is stale because timeouts/limits are already externalized in `multi-team-config.yaml`.

## 12. Glossary

- `Section 12 overall` — `Partial`. Many terms are still useful, but several glossary entries describe target or overstated behavior as if current: unlimited-depth Team-Leads, NotebookLM integration, progressive disclosure, silent memory flush, branch-per-worker memory flow, and full AgentRuntime/provider-failover semantics.

## 13. Future Improvements and Evolution Roadmap

- `13.1 High Priority` — `Accurate`. `F1`, `F2`, `F3`, `F4`, and `F5` are still open. `F5` is especially important because the main architecture text overstates failover maturity.
- `13.2 Medium Priority` — `Mixed`. `F6` is only partially resolved because container runtime exists but does not fully match the deployment claims. `F9` is stale because limits are already config-driven.
- `13.3 Medium Priority` — `Accurate`. Training/gamification/meta-agent work remains unimplemented.
- `13.4 Lower Priority` — `Accurate`. Plugin registry, SCM/tracker/notifier integration, SSE, and real web auth are still future work.
- `13.5 Exploration / Research` — `Accurate`. These are not implemented.

## Document-specific stale or undefined details

- `src/maestro.ts` is referenced repeatedly in Sections 5.2.1, 5.3, and 8.15, but the actual implementation is split across `src/main.ts`, `src/orchestration-engine.ts`, `src/delegation-engine.ts`, `src/prompt-assembler.ts`, and related modules.
- Section 5.2.3 names concrete server files that do not exist: `web/server/routes/notebooklm.ts`, `web/server/services/task-parser.ts`, `web/server/services/config-parser.ts`, `web/server/services/markdown-table.ts`.
- Section 5.3 names concrete types that do not exist: `ProviderConfig`, `ContainerPolicy`, and `LogEvent`.
- Section 8.5 claims session-bound web auth tokens and rate limiting are current, while Section 11.2 D3 correctly says web auth is not implemented.
- Section 8.2 says knowledge-graph branch selection uses task-domain metadata from `memory/knowledge-graph/index.md`; current code only extracts markdown links and matches domain tags against file paths (`src/memory/knowledge-graph.ts:67-88`).
- Section 8.7 describes `Flushing`, `MemoryPromotion`, and `Reflecting` as concrete lifecycle states, but no such state machine is implemented or persisted.
- Section 8.10 describes provider-aware token counting as the authoritative budget gate; the current implementation uses a simple char heuristic and string truncation.
- Section 8.17 and ADR-008 describe branch-per-worker Git-memory behavior as part of the current runtime, but the branch methods are dead code today (`src/memory/git-checkpoint.ts:79-116`).
- The web client itself admits that the memory explorer is unfinished and requires a missing `/api/memory` endpoint (`web/client/index.html:392-403`).

## Bottom line

The repository already contains a solid deterministic orchestration core: plan parsing/generation, wave scheduling, runtime abstraction, reconciliation, file-based coordination, handoff validation, redacted logging, and a basic web UI are real.

The main parity gap is that the architecture document currently describes a much more agent-recursive, memory-complete, security-rigid, and recovery-capable system than the codebase actually provides. The most important corrections are:
- Reclassify recursive delegation, full 4-level memory promotion, NotebookLM integration, provider failover, and robust session recovery as partial or future-state rather than current-state.
- Rewrite the plan-gate and security sections so they describe the current enforcement boundary honestly, especially for phase-1 authority and host-runtime bash.
- Refresh the web/server and code-level sections to match actual files, routes, and types.
