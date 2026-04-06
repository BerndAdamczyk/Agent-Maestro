import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { SystemConfig } from "./types.js";
import type { AgentRuntime } from "./runtime/agent-runtime.js";
import { RuntimeManager } from "./runtime-manager.js";
import { TmuxAgentRuntime } from "./runtime/tmux-agent-runtime.js";
import { DryRunAgentRuntime } from "./runtime/dry-run-runtime.js";
import { PlainProcessAgentRuntime } from "./runtime/plain-process-runtime.js";
import { ContainerAgentRuntime } from "./runtime/container-agent-runtime.js";
import { HybridAgentRuntime } from "./runtime/hybrid-agent-runtime.js";

export interface RuntimeDetectionOptions {
  hasTmuxBinary?: () => boolean;
  hasDockerRuntime?: () => boolean;
  devMode?: boolean;
}

export function createAgentRuntime(
  mode: string,
  config: SystemConfig,
  options: RuntimeDetectionOptions = {},
): AgentRuntime {
  const devMode = options.devMode ?? /^(?:1|true|yes)$/i.test(process.env["MAESTRO_DEV_MODE"] ?? "");
  const detectTmux = options.hasTmuxBinary ?? hasTmuxBinary;
  const detectDocker = options.hasDockerRuntime ?? hasDockerRuntime;

  const processRuntime = new PlainProcessAgentRuntime(config.limits.max_panes);
  const hostRuntime = detectTmux()
    ? new TmuxAgentRuntime(new RuntimeManager(config.tmux_session, config.limits.max_panes))
    : processRuntime;

  switch (mode) {
    case "auto":
      // Keep the default session flow on plain processes until the tmux/container
      // path handling is verified end-to-end. Dev mode still forces host panes.
      return devMode ? hostRuntime : processRuntime;
    case "dry-run":
    case "dryrun":
      return new DryRunAgentRuntime(config.limits.max_panes);
    case "container":
    case "hybrid":
      if (!detectDocker()) {
        console.warn("docker not available, falling back to host runtime");
        return hostRuntime;
      }
      return new HybridAgentRuntime(
        hostRuntime,
        new ContainerAgentRuntime(config.limits.max_panes),
        config.limits.max_panes,
      );
    case "plain-process":
    case "plain_process":
    case "process":
      return processRuntime;
    case "tmux":
      return hostRuntime;
    default:
      throw new Error(`Unsupported runtime '${mode}'. Expected 'auto', 'tmux', 'plain-process', 'container', or 'dry-run'.`);
  }
}

export function hasExistingSessionState(workspaceDir: string): boolean {
  const fileCandidates = [
    "status.md",
    "log.md",
    "log.jsonl",
  ];

  if (fileCandidates.some(file => existsSync(join(workspaceDir, file)))) {
    return true;
  }

  const dirCandidates = [
    "tasks",
    "runtime-policies",
    "runtime-sessions",
    "runtime-turns",
  ];

  return dirCandidates.some(dir => {
    const dirPath = join(workspaceDir, dir);
    return existsSync(dirPath) && readdirSync(dirPath).length > 0;
  });
}

function hasTmuxBinary(): boolean {
  try {
    execFileSync("tmux", ["-V"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function hasDockerRuntime(): boolean {
  try {
    execFileSync("docker", ["info"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
