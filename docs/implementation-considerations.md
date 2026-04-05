# Implementation Considerations

Undefined details, assumptions, and improvement suggestions discovered during the initial implementation. Items are grouped by category and tagged with priority.

---

## 1. Agent Runtime Integration (Critical -- Blocking)

### 1.1 Coding-Agent Framework Selection

The arc42 doc references "a coding-agent framework (e.g., Pi)" but doesn't specify which framework to use or how agents actually execute LLM calls. The current implementation has a **placeholder** in `DelegationEngine.buildLaunchCommand()` that logs a message but doesn't invoke a real agent runtime.

**What needs deciding:**
- Which coding-agent framework? Options: [Pi](https://github.com/mariozechner/pi-coding-agent), Claude Code CLI (`claude`), Aider, custom LLM loop
- How is the system prompt injected? (stdin pipe, file argument, environment variable, CLI flag)
- How does the framework report task completion? (exit code, status file write, special output marker)
- Does each agent get its own API key, or is there a shared key pool?

**Recommendation:** Abstract this behind a `AgentRuntime` interface with a `launch(promptFile, taskId, logFile)` method. Ship with a "dry-run" implementation that logs the prompt, and a "claude-code" implementation that invokes `claude --system-prompt-file`. This keeps the core orchestration framework-agnostic.

### 1.2 LLM Goal Decomposition

The Maestro currently receives a goal but doesn't connect to an LLM to decompose it into waves/tasks. The arc42 shows this in Section 6.1 ("Reason about decomposition" → "Task breakdown"), but the specific prompt and tool-call format is undefined.

**What needs deciding:**
- Is the Maestro itself an LLM agent (running in an agent framework), or is it a TypeScript program that calls the LLM API directly?
- How does the Maestro's wave/task decomposition work -- structured output (JSON mode) or free-form that gets parsed?
- Can the developer provide a pre-made plan.md instead of relying on LLM decomposition?

**Recommendation:** Support both modes: (1) Developer provides `workspace/plan.md` with explicit task breakdown (bypasses LLM decomposition), (2) Maestro uses structured output from LLM to generate the plan. Start with mode 1 as it's deterministic and testable.

---

## 2. Architecture Assumptions

### 2.1 Wave Dependency Detection

The arc42 describes wave-based scheduling (Section 6.6) but doesn't specify **how** tasks get assigned to waves. Currently, the `TaskManager.createTask()` accepts a `wave` parameter, meaning the caller must compute wave assignments.

**Options:**
- Manual: The Maestro/LLM explicitly assigns wave numbers during decomposition
- Automatic: A topological sort of task dependencies computes waves (dependencies → wave N, dependents → wave N+1)
- Hybrid: LLM proposes, system validates/re-sorts

**Current implementation:** Manual (wave is a parameter). Consider adding a `computeWaves(tasks)` utility that does topological sorting based on the `dependencies` field.

### 2.2 Container Runtime for Workers

ADR-002 specifies containers (Docker/Podman) for Worker-Agents in production mode, but the current implementation only uses tmux. The `RuntimeManager` would need a parallel `ContainerManager` class.

**What needs deciding:**
- Container image: pre-built with agent framework installed, or dynamically constructed?
- Volume mounts: which workspace paths are exposed to workers?
- Resource limits: specific CPU/memory/disk cgroup values?
- Network access: do workers need outbound HTTPS (for LLM API calls)?

**Recommendation:** Start with dev-mode (all tmux) as currently implemented. Container support can be added as a second `RuntimePlugin` implementation without changing the orchestration logic. The interface is already clean enough for this.

### 2.3 NotebookLM Integration

The arc42 lists NotebookLM as an external system with Playwright browser automation (Section 3.1), and agents have a `query_notebooklm` tool. The current implementation has no NotebookLM client.

**Recommendation:** This is a non-critical feature. Implement as a separate module that can be wired in later. The skill file (`skills/notebooklm.md`) already exists and can guide agents on when to use it once available.

---

## 3. Protocol Clarifications Needed

### 3.1 Handoff Report Enforcement

The arc42 mandates 4-section handoff reports (Section 2.3), but it's unclear who enforces this. If a worker writes a task file without the proper sections, is that:
- A validation error caught by the monitoring engine?
- A quality gate the lead checks before accepting?
- Just a convention agents are instructed to follow?

**Current implementation:** The `TaskManager.setHandoffReport()` requires all 4 sections. The `parseTaskFile()` extracts them if present. No runtime enforcement of completeness.

**Recommendation:** Add a `validateHandoffReport(taskId)` method that the lead's reconciliation step can call. Incomplete reports trigger a revision request.

### 3.2 Plan-Gate Polling Mechanism

The plan-approval gate (Section 6.2) requires the worker to STOP after writing the plan, then resume when approved. In practice:
- How does the worker agent know to stop? (It's instructed in the prompt, but what if the LLM doesn't comply?)
- How does it detect that `plan_approved` was set? (Poll the file? External signal?)
- Is there a timeout for plan review?

**Current implementation:** Plan-gate instructions are injected into the prompt. The worker is expected to set status to `plan_ready` and stop. Resumption requires the agent framework to support re-prompting the same agent session.

**Recommendation:** The monitoring engine should detect `plan_ready` status and hold delegation of Phase 2 until approval. If using a framework like Claude Code, the agent could be re-invoked with a "continue" message after approval.

### 3.3 Status File Atomicity

The arc42 acknowledges concurrent write risks (Section 8.11, Risk R4) and mentions write-tmp-then-rename as a [target] enhancement. The current implementation writes directly to files.

**Recommendation:** Implement atomic writes for `status.md` and `log.md` as a quick win:
```typescript
function atomicWrite(path: string, content: string): void {
  const tmp = path + ".tmp." + process.pid;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}
```

---

## 4. Improvement Suggestions

### 4.1 Task ID Format

The current task ID format is `task-001`, `task-002`, etc. (zero-padded sequential). This doesn't encode:
- Which wave the task belongs to
- Which agent it was assigned to
- Whether it's a fix-task

**Suggestion:** Consider `task-w2-003` (wave-aware) or keep flat IDs but add these as metadata. The flat format is simpler and the metadata is already in the task file.

### 4.2 Structured Logging Format

The arc42 mentions structured JSON logs as a [target] (Section 8.6). Even before adding that, the current log.md table format could benefit from a `level` column (info/warn/error) and a `taskId` column for correlation.

### 4.3 Health Check for Agent Framework

The monitoring engine checks tmux pane liveness, but doesn't verify the agent framework process inside the pane is healthy. A pane can be alive with a crashed node process inside it.

**Suggestion:** After checking pane existence, also check the pane's last few lines of output for error indicators (stack traces, "FATAL", exit codes).

### 4.4 Express v5 Compatibility

The package.json uses Express v5 (`^5.0.0`). Express 5 has breaking changes from v4 (no more `req.param()`, different error handling). The current routes are written for v5 compatibility, but this should be tested. If any issues arise, pinning to `^4.21.0` is a safe fallback.

### 4.5 Graceful Degradation Without tmux

If a developer doesn't have tmux installed, the entire system fails. Consider:
- Detecting tmux availability at startup and falling back to `child_process.spawn` with output piped to log files
- This loses the `attach` capability but keeps core functionality

### 4.6 Memory Directory in .gitignore

The `memory/sessions/` directory will accumulate JSONL files for every task. These are ephemeral (Level 1) and should potentially be in `.gitignore` while Level 2-4 memory files are tracked.

**Suggestion:** Add `memory/sessions/*.jsonl` to `.gitignore` but keep `memory/daily/`, `memory/agents/`, and `memory/knowledge-graph/` tracked.

### 4.7 Token Counting

The prompt assembler uses a rough `chars / 4` estimate for token counting. For production use, consider:
- Using `tiktoken` (or similar) for accurate token counts
- Adding a pre-assembly budget check that warns when components exceed their allocation

---

## 5. What's Not Implemented (from arc42 non-[target] features)

| Feature | Arc42 Reference | Status | Notes |
|---------|----------------|--------|-------|
| LLM API integration | Section 3.1 | Not implemented | Need to choose agent runtime framework |
| Goal → task decomposition | Section 6.1 | Not implemented | Requires LLM or manual plan.md |
| Plan-gate phase 2 resume | Section 6.2 | Partial | Instructions injected; actual pause/resume needs runtime support |
| Stall escalation ladder | Section 8.8 | Partial | Detection implemented; nudge/kill/reassign not wired |
| LLM failover chain | ADR-007 | Not implemented | Need provider abstraction layer |
| Context window budgeting | Section 8.10 | Partial | Truncation works; no accurate token counting |
| Secret-aware logging | Section 8.5 | Not implemented | Need redaction patterns |
| Prompt injection sanitization | Section 8.5 | Not implemented | Need content sanitizer for workspace file injection |

---

## 6. Quick Wins for Next Session

1. **Atomic file writes** for status.md and log.md (~10 lines of code)
2. **`computeWaves()`** utility for topological sorting of tasks by dependencies
3. **Add `memory/sessions/` to .gitignore** to avoid tracking ephemeral L1 files
4. **Handoff report validation** method in TaskManager
5. **Build and smoke test** -- `npm run build && node dist/src/main.js` with a test goal
