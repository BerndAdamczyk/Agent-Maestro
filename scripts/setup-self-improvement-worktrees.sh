#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PARENT_DIR="$(cd "$ROOT_DIR/.." && pwd)"
RUNNER_DIR="${MAESTRO_RUNNER_DIR:-$PARENT_DIR/agent-maestro-runner}"
RUNNER_SESSION="${MAESTRO_RUNNER_TMUX_SESSION:-agent-maestro-runner}"
RUNNER_PORT="${MAESTRO_RUNNER_PORT:-3000}"
TARGET_SESSION="${MAESTRO_TARGET_TMUX_SESSION:-agent-maestro}"
TARGET_PORT="${MAESTRO_TARGET_PORT:-3001}"

usage() {
  cat <<EOF
Usage:
  $0 setup
  $0 sync-runner
  $0 status

Environment overrides:
  MAESTRO_RUNNER_DIR
  MAESTRO_RUNNER_TMUX_SESSION
  MAESTRO_RUNNER_PORT
  MAESTRO_TARGET_TMUX_SESSION
  MAESTRO_TARGET_PORT
EOF
}

ensure_runner_worktree() {
  if git -C "$ROOT_DIR" worktree list --porcelain | grep -Fxq "worktree $RUNNER_DIR"; then
    return
  fi

  git -C "$ROOT_DIR" fetch origin main
  git -C "$ROOT_DIR" worktree add --detach "$RUNNER_DIR" main
}

ensure_runner_dependencies() {
  if [[ -d "$ROOT_DIR/node_modules" && ! -e "$RUNNER_DIR/node_modules" ]]; then
    ln -s "$ROOT_DIR/node_modules" "$RUNNER_DIR/node_modules"
  fi
}

write_target_local_context() {
  mkdir -p "$ROOT_DIR/shared-context"
  cat > "$ROOT_DIR/shared-context/LOCAL.md" <<EOF
# Worktree Role

This checkout is the mutable target worktree.

- Make source changes here.
- Run tests here.
- Commit and push from here.
- If you need Maestro to improve itself, start the runner with \`MAESTRO_TARGET_ROOT\` pointing at this checkout.

## Local Runtime Defaults
- Preferred tmux session: \`$TARGET_SESSION\`
- Preferred web port: \`$TARGET_PORT\`
EOF
}

write_runner_local_context() {
  mkdir -p "$RUNNER_DIR/shared-context"
  cat > "$RUNNER_DIR/shared-context/LOCAL.md" <<EOF
# Worktree Role

This checkout is the stable runner worktree.

- Use this worktree to run Maestro.
- Avoid editing source files here.
- Sync this worktree to \`origin/main\` after new commits land before starting a fresh session.
- Treat the target worktree as the place where code changes should be made.
- Start \`./run.sh\` here with \`MAESTRO_TARGET_ROOT\` pointing at the target checkout.

## Local Runtime Defaults
- tmux session: \`$RUNNER_SESSION\`
- web port: \`$RUNNER_PORT\`
- target checkout: \`$ROOT_DIR\`
EOF
}

setup() {
  ensure_runner_worktree
  ensure_runner_dependencies
  write_target_local_context
  write_runner_local_context

  cat <<EOF
Self-improvement worktrees are ready.

Target worktree:
  $ROOT_DIR
  Role: edit, test, commit, push
  Suggested tmux/web: $TARGET_SESSION / $TARGET_PORT

Runner worktree:
  $RUNNER_DIR
  Role: run Maestro against the target repo workflow
  tmux/web: $RUNNER_SESSION / $RUNNER_PORT

Run the runner:
  cd "$RUNNER_DIR"
  MAESTRO_TARGET_ROOT="$ROOT_DIR" MAESTRO_TMUX_SESSION="$RUNNER_SESSION" MAESTRO_PORT="$RUNNER_PORT" ./run.sh "Improve the target repo"

Work in the target:
  cd "$ROOT_DIR"
  git status

After pushing new changes to main:
  $0 sync-runner
EOF
}

sync_runner() {
  ensure_runner_worktree
  ensure_runner_dependencies
  git -C "$ROOT_DIR" fetch origin main
  git -C "$RUNNER_DIR" fetch origin main
  git -C "$RUNNER_DIR" switch --detach origin/main
  write_runner_local_context
  echo "Runner synced to origin/main at $(git -C "$RUNNER_DIR" rev-parse --short HEAD)"
}

status() {
  cat <<EOF
Target worktree: $ROOT_DIR
Runner worktree: $RUNNER_DIR

Git worktrees:
$(git -C "$ROOT_DIR" worktree list)

Target local context:
$(if [[ -f "$ROOT_DIR/shared-context/LOCAL.md" ]]; then cat "$ROOT_DIR/shared-context/LOCAL.md"; else echo "(missing)"; fi)

Runner local context:
$(if [[ -f "$RUNNER_DIR/shared-context/LOCAL.md" ]]; then cat "$RUNNER_DIR/shared-context/LOCAL.md"; else echo "(missing)"; fi)
EOF
}

case "${1:-setup}" in
  setup) setup ;;
  sync-runner) sync_runner ;;
  status) status ;;
  -h|--help|help) usage ;;
  *)
    usage
    exit 1
    ;;
esac
