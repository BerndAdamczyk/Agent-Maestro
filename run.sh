#!/usr/bin/env bash
# Agent Maestro - CLI entry point
# Usage:
#   ./run.sh "Build auth module"       -- start new session with goal
#   ./run.sh --resume                  -- resume existing session

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SESSION_NAME="agent-maestro"

archive_workspace() {
  local workspace_dir="$SCRIPT_DIR/workspace"
  if [[ ! -d "$workspace_dir" ]]; then
    return
  fi

  if find "$workspace_dir" -mindepth 1 -print -quit | grep -q .; then
    local backup_dir="$SCRIPT_DIR/workspace.bak.$(date +%Y%m%d-%H%M%S)"
    mv "$workspace_dir" "$backup_dir"
    echo "Archived existing workspace to $(basename "$backup_dir")"
  fi
}

build_maestro_command() {
  local command="cd '$SCRIPT_DIR' && MAESTRO_ROOT='$SCRIPT_DIR' MAESTRO_DEV_MODE='$DEV_MODE' node dist/src/main.js"
  if [[ "$RESUME" == "true" ]]; then
    command="$command --resume"
  fi
  printf '%s' "$command"
}

launch_maestro_window() {
  tmux new-window -d -t "$SESSION_NAME" -n maestro "$(build_maestro_command)"
}

usage() {
  echo "Usage: $0 <goal> [options]"
  echo "       $0 --resume"
  echo ""
  echo "Options:"
  echo "  --resume    Resume an existing session from workspace state"
  echo "  --dev       Force dev mode (all agents in tmux, no containers)"
  echo "  --help      Show this help"
  exit 1
}

RESUME=false
DEV_MODE=false
GOAL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --resume)  RESUME=true; shift ;;
    --dev)     DEV_MODE=true; shift ;;
    --help)    usage ;;
    *)         GOAL="$1"; shift ;;
  esac
done

if [[ "$RESUME" == "false" && -z "$GOAL" ]]; then
  usage
fi

# Ensure build is up to date
echo "Building TypeScript..."
cd "$SCRIPT_DIR" && npm run build

# Write goal if starting fresh
if [[ "$RESUME" == "false" ]]; then
  archive_workspace
  mkdir -p "$SCRIPT_DIR/workspace"
  echo "# Goal" > "$SCRIPT_DIR/workspace/goal.md"
  echo "" >> "$SCRIPT_DIR/workspace/goal.md"
  echo "$GOAL" >> "$SCRIPT_DIR/workspace/goal.md"
  echo "" >> "$SCRIPT_DIR/workspace/goal.md"
  echo "_Created: $(date -Iseconds)_" >> "$SCRIPT_DIR/workspace/goal.md"
fi

# Create or attach to tmux session
if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  if [[ "$RESUME" == "true" ]]; then
    echo "Resuming session '$SESSION_NAME'..."
    if tmux list-windows -t "$SESSION_NAME" -F '#W' | grep -qx 'maestro'; then
      tmux respawn-window -k -t "$SESSION_NAME:maestro" "$(build_maestro_command)"
    else
      launch_maestro_window
    fi
  else
    echo "Replacing session '$SESSION_NAME' for a fresh run..."
    tmux kill-session -t "$SESSION_NAME"
    tmux new-session -d -s "$SESSION_NAME" -n bootstrap
    launch_maestro_window
    tmux kill-window -t "$SESSION_NAME:bootstrap"
  fi
else
  echo "Creating tmux session '$SESSION_NAME'..."
  tmux new-session -d -s "$SESSION_NAME" -n bootstrap
  launch_maestro_window
  tmux kill-window -t "$SESSION_NAME:bootstrap"
fi

echo "Maestro launched in tmux session '$SESSION_NAME'"
echo "  Attach: tmux attach -t $SESSION_NAME"
echo "  Web UI: http://localhost:3000"
