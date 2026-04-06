# Agent Maestro

Agent Maestro is a local-first multi-agent orchestration system for software work. The current implementation is a deterministic TypeScript control plane that:

- reads a goal from `workspace/goal.md`
- loads or generates a task plan
- computes dependency waves
- launches agents through a runtime abstraction
- monitors task progress through workspace files
- runs reconciliation commands between waves
- exposes a local web UI on port `3000`

## Current Status

The repository already has a working orchestration core, hybrid runtimes, file-based coordination, handoff validation, memory scaffolding, and a web UI.

Important limitations in the current implementation:

- the shipped hierarchy is effectively `Maestro -> Team Leads -> Workers`
- recursive agent-to-agent delegation is not fully implemented
- NotebookLM integration is documented but not implemented
- the memory explorer UI is still a placeholder
- `run.sh` currently depends on `tmux`

For a section-by-section parity check against the architecture doc, see [docs/arc42-implementation-parity-audit.md](docs/arc42-implementation-parity-audit.md).

## Requirements

- Node.js `>= 22`
- `npm`
- `tmux`
- `pi` CLI available in `PATH`
- `docker` if you want worker-container isolation in auto mode

The worker image installs Pi with:

```bash
npm install -g @mariozechner/pi-coding-agent
```

If `pi` is not installed locally, agent execution will fail even though the project itself builds.

Maestro reuses Pi credentials from `~/.pi/agent/auth.json`. It also bridges `codex login` state from `~/.codex/auth.json`, so stored OpenAI API keys and ChatGPT Codex subscriptions can be used without a separate Pi login.

## Install

```bash
npm install
npm run build
```

Optional sanity check:

```bash
npm run lint
```

## Quick Start

Start a new session with a goal:

```bash
./run.sh "Build auth module"
```

Then open:

- `http://localhost:3000`

To watch the runtime directly:

```bash
tmux attach -t agent-maestro
```

To resume an existing session:

```bash
./run.sh --resume
```

## Runtime Modes

Default behavior:

- `run.sh` launches Maestro inside `tmux`
- if Docker is available and `--dev` is not set, workers use the container runtime
- if Docker is unavailable, the app falls back to the host runtime

Development mode:

```bash
./run.sh "Build auth module" --dev
```

This forces host-side execution instead of worker containers.

Advanced manual runtime selection is available through `MAESTRO_RUNTIME` when launching `dist/src/main.js` directly:

- `auto`
- `tmux`
- `plain-process`
- `container`
- `dry-run`

Example:

```bash
MAESTRO_RUNTIME=plain-process node dist/src/main.js
```

Because `run.sh` itself uses `tmux`, direct `node` startup is the workaround if you want to avoid the shell wrapper.

## Manual Start Without `run.sh`

Create a goal file first:

```bash
mkdir -p workspace
cat > workspace/goal.md <<'EOF'
# Goal

Build auth module
EOF
```

Then start Maestro directly:

```bash
node dist/src/main.js
```

Or force a specific runtime:

```bash
MAESTRO_RUNTIME=plain-process node dist/src/main.js
```

## How It Works

1. `run.sh` writes `workspace/goal.md` and starts Maestro.
2. Maestro loads `multi-team-config.yaml`, agent definitions, and memory scaffolding.
3. If `workspace/plan.md` exists, it is treated as authoritative.
4. Otherwise Maestro asks the planner model to generate a structured `TaskPlan`.
5. Tasks are assigned to dependency waves by topological sorting.
6. Workers are launched through the runtime abstraction.
7. Progress is tracked through task files, `status.md`, `log.md`, and runtime output.
8. Reconciliation commands run between waves.

## Web UI

The local UI includes:

- chat-like activity feed
- dashboard
- task table
- agent overview
- config viewer
- placeholder memory tab

The server binds to `127.0.0.1` and serves:

- REST endpoints under `/api/*`
- WebSocket updates for file changes
- tmux pane output polling endpoints

## Project Layout

```text
agents/                  Agent definitions in Markdown frontmatter format
docker/                  Worker runtime image
docs/                    Architecture docs and parity audit
memory/                  Runtime memory files and scaffolding
skills/                  Skill documents injected into prompts
src/                     Orchestrator, runtimes, memory, planning, monitoring
web/                     Express server and vanilla JS client
workspace/               Goal, plan, status, log, tasks, runtime state
multi-team-config.yaml   Main project configuration
run.sh                   CLI entry point
```

## Key Files

- `src/main.ts` — bootstraps the system and wires the orchestration loop
- `src/orchestration-engine.ts` — deterministic wave execution
- `src/task-plan.ts` — plan parsing, validation, and wave assignment
- `src/delegation-engine.ts` — task delegation and runtime launch
- `src/runtime/` — tmux, process, container, hybrid, and dry-run backends
- `src/memory/` — session DAG, daily protocol, expertise store, knowledge graph, git checkpoints
- `web/server/index.ts` — Express + WebSocket server
- `web/client/index.html` — vanilla JS UI

## Configuration

Primary config lives in:

- `multi-team-config.yaml`

Agent definitions live in:

- `agents/maestro.md`
- `agents/leads/*.md`
- `agents/workers/*.md`

Useful config areas:

- `paths`
- `teams`
- `model_tier_policy`
- `memory`
- `limits`
- `tmux_session`

## Development

Build:

```bash
npm run build
```

Type-check:

```bash
npm run lint
```

Watch TypeScript:

```bash
npm run dev
```

Start only the web server from built output:

```bash
npm run start:server
```

## Documentation

- Architecture: [docs/arc42-architecture.md](docs/arc42-architecture.md)
- Implementation parity audit: [docs/arc42-implementation-parity-audit.md](docs/arc42-implementation-parity-audit.md)
- Implementation notes: [implementation-considerations.md](implementation-considerations.md)

## Notes

- This repo builds successfully with `npm run build` and `npm run lint`.
- Runtime behavior still depends on external tools such as `tmux`, `pi`, and optionally `docker`.
- The architecture document is ahead of the implementation in several areas; use the parity audit above as the current source of truth for those gaps.
