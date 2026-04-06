# agent-maestro

This is the shared context injected into every agent's system prompt.

## Project Structure
- `workspace/` - Coordination files (goal, plan, status, log, tasks)
- `agents/` - Agent definitions (Maestro, Leads, Workers)
- `memory/` - 4-level memory system
- `skills/` - Reusable skill documents

## Self-Improvement Workflow
- Prefer a two-worktree setup when Maestro is improving its own runtime or orchestration code.
- Use the current checkout as the mutable target worktree where code changes are made and committed to `main`.
- Use a separate detached runner worktree to execute Maestro against the target repo.
- Start the runner with `MAESTRO_TARGET_ROOT` pointing at the target checkout so workspace files, task files, and code edits land in the target repo instead of the runner checkout.
- Keep worktree-specific instructions in `shared-context/LOCAL.md`. That file is intentionally local-only and is not committed.

## Worktree Roles
- Target worktree: allowed to edit code, run tests, commit, and push.
- Runner worktree: should be treated as execution-only; avoid editing source there unless you are intentionally debugging the runner itself.

## Updating The Runner
- After new changes land on `main`, sync the runner worktree to `origin/main` before starting a new self-improvement session.
- If the runner and target are both active, they must use different tmux session names and web ports.
