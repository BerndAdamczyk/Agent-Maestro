#!/usr/bin/env bash
# Agent Maestro - CLI entry point
# Usage:
#   ./run.sh "Build auth module"       -- start new session with goal
#   ./run.sh --resume                  -- resume existing session

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SESSION_NAME="agent-maestro"

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
if [[ ! -f "$SCRIPT_DIR/dist/src/main.js" ]]; then
  echo "Building TypeScript..."
  cd "$SCRIPT_DIR" && npm run build
fi

# Write goal if starting fresh
if [[ "$RESUME" == "false" ]]; then
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
    export MAESTRO_RESUME=true
  else
    echo "Session '$SESSION_NAME' already exists. Use --resume to re-attach."
    exit 1
  fi
else
  echo "Creating tmux session '$SESSION_NAME'..."
  tmux new-session -d -s "$SESSION_NAME" -n maestro
fi

# Launch maestro in pane 0
export MAESTRO_ROOT="$SCRIPT_DIR"
export MAESTRO_DEV_MODE="$DEV_MODE"

tmux send-keys -t "$SESSION_NAME:maestro" \
  "cd '$SCRIPT_DIR' && node dist/src/main.js $([ \"$RESUME\" == 'true' ] && echo '--resume')" Enter

echo "Maestro launched in tmux session '$SESSION_NAME'"
echo "  Attach: tmux attach -t $SESSION_NAME"
echo "  Web UI: http://localhost:3000"
