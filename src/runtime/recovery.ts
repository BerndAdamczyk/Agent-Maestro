/**
 * Best-effort recovery helpers for persisted worker runtimes.
 */

import { execFileSync } from "node:child_process";
import type { PersistedActiveWorker } from "../types.js";

export interface RuntimeTeardownResult {
  attempted: boolean;
  commands: string[];
}

export function teardownPersistedRuntime(worker: PersistedActiveWorker): RuntimeTeardownResult {
  switch (worker.runtimeType) {
    case "tmux":
      return teardownTmuxRuntime(worker.runtimeId);
    case "container":
      return teardownContainerRuntime(worker.taskId, worker.runtimeId);
    case "process":
      return teardownProcessRuntime(worker.taskId);
    default:
      return {
        attempted: false,
        commands: [],
      };
  }
}

function teardownTmuxRuntime(paneId: string): RuntimeTeardownResult {
  runCommand("tmux", ["kill-pane", "-t", paneId]);
  return {
    attempted: true,
    commands: [`tmux kill-pane -t ${paneId}`],
  };
}

function teardownContainerRuntime(taskId: string, runtimeId: string): RuntimeTeardownResult {
  const commands: string[] = [];
  const nameFilter = `agent-maestro-${taskId}-`;
  const containerIds = captureLines("docker", ["ps", "-aq", "--filter", `name=${nameFilter}`]);

  if (containerIds.length === 0 && runtimeId) {
    commands.push(`docker ps -aq --filter name=${nameFilter}`);
  }

  for (const containerId of containerIds) {
    runCommand("docker", ["rm", "-f", containerId]);
    commands.push(`docker rm -f ${containerId}`);
  }

  return {
    attempted: true,
    commands,
  };
}

function teardownProcessRuntime(taskId: string): RuntimeTeardownResult {
  const escapedTaskId = escapeShellRegex(taskId);
  const pattern = `dist/src/runtime/pi-runner\\.js.*${escapedTaskId}|--message-file.*/${escapedTaskId}-turn-`;
  const command = [
    "pids=$(pgrep -f",
    shellQuote(pattern),
    "|| true);",
    "if [ -n \"$pids\" ]; then kill -TERM $pids || true; sleep 1; fi;",
    "pids=$(pgrep -f",
    shellQuote(pattern),
    "|| true);",
    "if [ -n \"$pids\" ]; then kill -KILL $pids || true; fi",
  ].join(" ");

  runCommand("bash", ["-lc", command]);
  return {
    attempted: true,
    commands: [`bash -lc ${command}`],
  };
}

function captureLines(command: string, args: string[]): string[] {
  try {
    const output = execFileSync(command, args, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
    return output.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function runCommand(command: string, args: string[]): void {
  try {
    execFileSync(command, args, { stdio: "ignore" });
  } catch {
    // Best-effort teardown; workers may already be gone.
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function escapeShellRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
