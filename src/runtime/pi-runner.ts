/**
 * Small wrapper that runs a single Pi turn from file-backed inputs.
 */

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { resolvePiCommand } from "../pi-runtime-support.js";

interface CliArgs {
  cwd: string;
  sessionFile: string;
  promptFile: string;
  messageFile: string;
  model: string;
  tools: string;
  extension: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  mkdirSync(dirname(args.sessionFile), { recursive: true });

  const prompt = readFileSync(args.promptFile, "utf-8");
  const message = readFileSync(args.messageFile, "utf-8").trim() || DEFAULT_MESSAGE;

  const piArgs = [
    "-p",
    "--session",
    args.sessionFile,
    "--model",
    args.model,
    "--system-prompt",
    prompt,
    "--tools",
    args.tools,
    "--extension",
    args.extension,
    message,
  ];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(resolvePiCommand(), piArgs, {
      cwd: args.cwd,
      env: process.env,
      stdio: "inherit",
    });

    child.on("exit", code => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`pi exited with status ${code ?? "unknown"}`));
    });

    child.on("error", reject);
  });
}

function parseArgs(argv: string[]): CliArgs {
  const values = new Map<string, string>();

  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--") || !value) {
      throw new Error(`Invalid argument sequence: ${argv.join(" ")}`);
    }
    values.set(key.slice(2), value);
  }

  return {
    cwd: requireArg(values, "cwd"),
    sessionFile: requireArg(values, "session-file"),
    promptFile: requireArg(values, "prompt-file"),
    messageFile: requireArg(values, "message-file"),
    model: requireArg(values, "model"),
    tools: requireArg(values, "tools"),
    extension: requireArg(values, "extension"),
  };
}

function requireArg(values: Map<string, string>, key: string): string {
  const value = values.get(key);
  if (!value) {
    throw new Error(`Missing required argument --${key}`);
  }
  return value;
}

const DEFAULT_MESSAGE = "Read the assigned task file, follow the runtime policy, and complete the current task turn.";

main().catch(err => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
