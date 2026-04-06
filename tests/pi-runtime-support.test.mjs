import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  getForwardedProviderEnv,
  resolvePiAgentDir,
  resolvePiCommand,
} from "../dist/src/pi-runtime-support.js";

test("resolvePiCommand prefers explicit PI_BIN", () => {
  assert.equal(resolvePiCommand({ PI_BIN: "/custom/pi" }), "/custom/pi");
});

test("getForwardedProviderEnv keeps supported credentials only", () => {
  assert.deepEqual(
    getForwardedProviderEnv({
      ANTHROPIC_API_KEY: "anthropic-key",
      GEMINI_API_KEY: "gemini-key",
      UNRELATED: "ignored",
    }),
    {
      ANTHROPIC_API_KEY: "anthropic-key",
      GEMINI_API_KEY: "gemini-key",
    },
  );
});

test("resolvePiAgentDir honors PI_CODING_AGENT_DIR when it exists", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "agent-maestro-pi-"));
  assert.equal(resolvePiAgentDir({ PI_CODING_AGENT_DIR: agentDir }), agentDir);
});
