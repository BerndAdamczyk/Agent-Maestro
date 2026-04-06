import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildPiTurnArgs,
  getForwardedProviderEnv,
  hasPiProviderCredentials,
  resolvePiAgentDir,
  resolvePiCommand,
} from "../dist/src/pi-runtime-support.js";

test("resolvePiCommand prefers explicit PI_BIN", () => {
  assert.equal(resolvePiCommand({ PI_BIN: "/custom/pi" }), "/custom/pi");
});

test("buildPiTurnArgs disables extension discovery and loads only the explicit runtime extension", () => {
  const args = buildPiTurnArgs({
    sessionFile: "/tmp/session.jsonl",
    model: "openai-codex/gpt-5.4",
    prompt: "system prompt",
    tools: "read,write,edit,bash",
    extension: "/tmp/maestro-policy-extension.js",
    message: "Complete the current task turn.",
  });

  assert.deepEqual(args, [
    "-p",
    "--no-extensions",
    "--session",
    "/tmp/session.jsonl",
    "--model",
    "openai-codex/gpt-5.4",
    "--system-prompt",
    "system prompt",
    "--tools",
    "read,write,edit,bash",
    "--extension",
    "/tmp/maestro-policy-extension.js",
    "Complete the current task turn.",
  ]);
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

test("getForwardedProviderEnv reuses the API key stored by codex login", () => {
  const homeDir = mkdtempSync(join(tmpdir(), "agent-maestro-codex-home-"));
  const codexDir = join(homeDir, ".codex");
  mkdirSync(codexDir, { recursive: true });
  writeFileSync(join(codexDir, "auth.json"), JSON.stringify({
    auth_mode: "api_key",
    OPENAI_API_KEY: "sk-from-codex-login",
  }, null, 2));

  assert.deepEqual(
    getForwardedProviderEnv({ HOME: homeDir }),
    {
      OPENAI_API_KEY: "sk-from-codex-login",
    },
  );
});

test("resolvePiAgentDir honors PI_CODING_AGENT_DIR when it exists", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "agent-maestro-pi-"));
  assert.equal(resolvePiAgentDir({ PI_CODING_AGENT_DIR: agentDir }), agentDir);
});

test("hasPiProviderCredentials recognizes ChatGPT codex login for openai-codex", () => {
  const homeDir = mkdtempSync(join(tmpdir(), "agent-maestro-codex-home-"));
  const codexDir = join(homeDir, ".codex");
  mkdirSync(codexDir, { recursive: true });

  writeFileSync(join(codexDir, "auth.json"), JSON.stringify({
    auth_mode: "chatgpt",
    tokens: {
      access_token: makeJwt({
        exp: Math.floor(Date.now() / 1000) + 3600,
        "https://api.openai.com/auth": {
          chatgpt_account_id: "acct-from-jwt",
        },
      }),
      refresh_token: "refresh-token",
      account_id: "acct-from-auth-file",
    },
  }, null, 2));

  assert.equal(hasPiProviderCredentials("openai-codex", { HOME: homeDir }), true);
});

test("resolvePiAgentDir prepares a merged Pi auth dir from codex login", () => {
  const homeDir = mkdtempSync(join(tmpdir(), "agent-maestro-codex-home-"));
  const piAgentDir = join(homeDir, ".pi", "agent");
  const codexDir = join(homeDir, ".codex");
  mkdirSync(piAgentDir, { recursive: true });
  mkdirSync(codexDir, { recursive: true });

  writeFileSync(join(piAgentDir, "auth.json"), JSON.stringify({
    anthropic: {
      type: "oauth",
      access: "anthropic-access",
      refresh: "anthropic-refresh",
      expires: 1234,
    },
  }, null, 2));
  writeFileSync(join(piAgentDir, "settings.json"), JSON.stringify({ theme: "test" }, null, 2));

  const expSeconds = Math.floor(Date.now() / 1000) + 3600;
  const accessToken = makeJwt({
    exp: expSeconds,
    "https://api.openai.com/auth": {
      chatgpt_account_id: "acct-from-jwt",
    },
  });
  writeFileSync(join(codexDir, "auth.json"), JSON.stringify({
    auth_mode: "chatgpt",
    OPENAI_API_KEY: "",
    tokens: {
      access_token: accessToken,
      refresh_token: "refresh-token",
      account_id: "acct-from-auth-file",
    },
  }, null, 2));

  const preparedDir = resolvePiAgentDir({ HOME: homeDir });
  assert.ok(preparedDir);
  assert.notEqual(preparedDir, piAgentDir);
  assert.equal(readFileSync(join(preparedDir, "settings.json"), "utf8"), JSON.stringify({ theme: "test" }, null, 2));

  const mergedAuth = JSON.parse(readFileSync(join(preparedDir, "auth.json"), "utf8"));
  assert.deepEqual(mergedAuth.anthropic, {
    type: "oauth",
    access: "anthropic-access",
    refresh: "anthropic-refresh",
    expires: 1234,
  });
  assert.deepEqual(mergedAuth["openai-codex"], {
    type: "oauth",
    access: accessToken,
    refresh: "refresh-token",
    expires: expSeconds * 1000,
    accountId: "acct-from-auth-file",
  });
});

test("hasPiProviderCredentials recognizes the API key stored by codex login", () => {
  const homeDir = mkdtempSync(join(tmpdir(), "agent-maestro-codex-home-"));
  const codexDir = join(homeDir, ".codex");
  mkdirSync(codexDir, { recursive: true });

  writeFileSync(join(codexDir, "auth.json"), JSON.stringify({
    auth_mode: "api_key",
    OPENAI_API_KEY: "sk-from-codex-login",
  }, null, 2));

  assert.equal(hasPiProviderCredentials("openai", { HOME: homeDir }), true);
});

function makeJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.signature`;
}
