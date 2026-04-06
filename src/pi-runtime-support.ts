import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PI_LOOKUP_COMMAND = "command -v pi";
const PI_AUTH_FILENAME = "auth.json";
const OPENAI_CODEX_PROVIDER = "openai-codex";
const CODEX_AUTH_CLAIM = "https://api.openai.com/auth";
const preparedPiAgentDirs = new Map<string, string>();

const FORWARDED_PROVIDER_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_OAUTH_TOKEN",
  "OPENAI_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_BASE_URL",
  "AZURE_OPENAI_RESOURCE_NAME",
  "AZURE_OPENAI_API_VERSION",
  "AZURE_OPENAI_DEPLOYMENT_NAME_MAP",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "CEREBRAS_API_KEY",
  "XAI_API_KEY",
  "OPENROUTER_API_KEY",
  "AI_GATEWAY_API_KEY",
  "ZAI_API_KEY",
  "MISTRAL_API_KEY",
  "MINIMAX_API_KEY",
  "MINIMAX_CN_API_KEY",
  "OPENCODE_API_KEY",
  "KIMI_API_KEY",
  "HF_TOKEN",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_BEARER_TOKEN_BEDROCK",
  "AWS_REGION",
].sort();

const PROVIDER_ENV_KEYS: Record<string, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY", "ANTHROPIC_OAUTH_TOKEN"],
  "azure-openai-responses": [
    "AZURE_OPENAI_API_KEY",
    "AZURE_OPENAI_BASE_URL",
    "AZURE_OPENAI_RESOURCE_NAME",
  ],
  google: ["GEMINI_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  groq: ["GROQ_API_KEY"],
  cerebras: ["CEREBRAS_API_KEY"],
  xai: ["XAI_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  "vercel-ai-gateway": ["AI_GATEWAY_API_KEY"],
  zai: ["ZAI_API_KEY"],
  mistral: ["MISTRAL_API_KEY"],
  minimax: ["MINIMAX_API_KEY", "MINIMAX_CN_API_KEY"],
  opencode: ["OPENCODE_API_KEY"],
  "opencode-go": ["OPENCODE_API_KEY"],
  huggingface: ["HF_TOKEN"],
  "kimi-coding": ["KIMI_API_KEY"],
};

export function resolvePiCommand(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env["PI_BIN"]?.trim();
  if (explicit) {
    return explicit;
  }

  for (const shell of candidateShells(env)) {
    try {
      const resolved = execFileSync(shell, ["-lc", PI_LOOKUP_COMMAND], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (resolved) {
        return resolved;
      }
    } catch {
      // Try the next shell candidate.
    }
  }

  return "pi";
}

export function buildPiTurnArgs(params: {
  sessionFile: string;
  model: string;
  prompt: string;
  tools: string;
  extension: string;
  message: string;
}): string[] {
  return [
    "-p",
    "--no-extensions",
    "--session",
    params.sessionFile,
    "--model",
    params.model,
    "--system-prompt",
    params.prompt,
    "--tools",
    params.tools,
    "--extension",
    params.extension,
    params.message,
  ];
}

export function getForwardedProviderEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const forwarded: Record<string, string> = {};

  for (const key of FORWARDED_PROVIDER_ENV_KEYS) {
    const value = env[key];
    if (typeof value === "string" && value.trim() !== "") {
      forwarded[key] = value;
    }
  }

  if (!forwarded["OPENAI_API_KEY"]) {
    const codexApiKey = readCodexOpenAIApiKey(env);
    if (codexApiKey) {
      forwarded["OPENAI_API_KEY"] = codexApiKey;
    }
  }

  return forwarded;
}

export function resolvePiAgentDir(env: NodeJS.ProcessEnv = process.env): string | null {
  const baseDir = resolveBasePiAgentDir(env);
  const baseAuthEntries = readAuthEntries(baseDir ? join(baseDir, PI_AUTH_FILENAME) : null);
  const mergedAuthEntries = readPiAuthEntries(env);
  const needsPreparedDir = Object.keys(mergedAuthEntries).some(provider => !(provider in baseAuthEntries));

  if (!needsPreparedDir) {
    return baseDir;
  }

  return preparePiAgentDir(baseDir, mergedAuthEntries, env);
}

export function hasPiModelCredentials(model: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const provider = model.split("/", 1)[0]?.trim().toLowerCase();
  if (!provider) {
    return false;
  }

  return hasPiProviderCredentials(provider, env);
}

export function hasPiProviderCredentials(provider: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const normalizedProvider = provider.trim().toLowerCase();
  const envKeys = PROVIDER_ENV_KEYS[normalizedProvider] ?? [];

  for (const key of envKeys) {
    const value = env[key];
    if (typeof value === "string" && value.trim() !== "") {
      return true;
    }
  }

  const authEntries = readPiAuthEntries(env);
  const authEntry = authEntries[normalizedProvider];
  return typeof authEntry === "object" && authEntry !== null;
}

function candidateShells(env: NodeJS.ProcessEnv): string[] {
  const shells = [env["SHELL"], "bash", "sh"];
  return [...new Set(shells.filter((value): value is string => typeof value === "string" && value.trim() !== ""))];
}

function readPiAuthEntries(env: NodeJS.ProcessEnv): Record<string, unknown> {
  const authEntries = readAuthEntries(resolveBasePiAgentAuthPath(env));

  for (const [provider, credential] of Object.entries(buildCodexPiAuthEntries(env))) {
    if (!(provider in authEntries)) {
      authEntries[provider] = credential;
    }
  }

  return authEntries;
}

function resolveBasePiAgentDir(env: NodeJS.ProcessEnv): string | null {
  const explicit = env["PI_CODING_AGENT_DIR"]?.trim();
  if (explicit && existsSync(explicit)) {
    return explicit;
  }

  const home = env["HOME"]?.trim();
  if (!home) {
    return null;
  }

  const defaultDir = join(home, ".pi", "agent");
  return existsSync(defaultDir) ? defaultDir : null;
}

function resolveBasePiAgentAuthPath(env: NodeJS.ProcessEnv): string | null {
  const agentDir = resolveBasePiAgentDir(env);
  return agentDir ? join(agentDir, PI_AUTH_FILENAME) : null;
}

function resolveCodexDir(env: NodeJS.ProcessEnv): string | null {
  const explicit = env["CODEX_HOME"]?.trim();
  if (explicit && existsSync(explicit)) {
    return explicit;
  }

  const home = env["HOME"]?.trim();
  if (!home) {
    return null;
  }

  const defaultDir = join(home, ".codex");
  return existsSync(defaultDir) ? defaultDir : null;
}

function resolveCodexAuthPath(env: NodeJS.ProcessEnv): string | null {
  const codexDir = resolveCodexDir(env);
  return codexDir ? join(codexDir, PI_AUTH_FILENAME) : null;
}

function readAuthEntries(authPath: string | null): Record<string, unknown> {
  if (!authPath || !existsSync(authPath)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(authPath, "utf-8"));
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function readCodexOpenAIApiKey(env: NodeJS.ProcessEnv): string | null {
  const codexAuth = readCodexAuth(env);
  return normalizeString(codexAuth?.["OPENAI_API_KEY"]);
}

function readCodexAuth(env: NodeJS.ProcessEnv): Record<string, unknown> | null {
  const authEntries = readAuthEntries(resolveCodexAuthPath(env));
  return Object.keys(authEntries).length > 0 ? authEntries : null;
}

function buildCodexPiAuthEntries(env: NodeJS.ProcessEnv): Record<string, unknown> {
  const codexAuth = readCodexAuth(env);
  if (!codexAuth) {
    return {};
  }

  const authMode = normalizeString(codexAuth["auth_mode"]);
  const openAIApiKey = normalizeString(codexAuth["OPENAI_API_KEY"]);
  const openAICodexOAuth = buildOpenAICodexOAuthCredential(codexAuth);
  const entries: Record<string, unknown> = {};

  if (openAIApiKey) {
    entries["openai"] = {
      type: "api_key",
      key: openAIApiKey,
    };
  }

  if (authMode === "api_key") {
    if (openAIApiKey) {
      entries[OPENAI_CODEX_PROVIDER] = {
        type: "api_key",
        key: openAIApiKey,
      };
    } else if (openAICodexOAuth) {
      entries[OPENAI_CODEX_PROVIDER] = openAICodexOAuth;
    }
    return entries;
  }

  if (openAICodexOAuth) {
    entries[OPENAI_CODEX_PROVIDER] = openAICodexOAuth;
  } else if (openAIApiKey) {
    entries[OPENAI_CODEX_PROVIDER] = {
      type: "api_key",
      key: openAIApiKey,
    };
  }

  return entries;
}

function buildOpenAICodexOAuthCredential(codexAuth: Record<string, unknown>): Record<string, unknown> | null {
  const tokens = codexAuth["tokens"];
  if (typeof tokens !== "object" || tokens === null) {
    return null;
  }
  const tokenValues = tokens as Record<string, unknown>;

  const access = normalizeString(tokenValues["access_token"]);
  const refresh = normalizeString(tokenValues["refresh_token"]);
  const accountId = normalizeString(tokenValues["account_id"]) ?? readAccountIdFromJwt(access);

  if (!access || !refresh || !accountId) {
    return null;
  }

  return {
    type: "oauth",
    access,
    refresh,
    expires: readJwtExpiry(access) ?? Date.now(),
    accountId,
  };
}

function readAccountIdFromJwt(token: string | null): string | null {
  const authClaim = readJwtPayload(token)?.[CODEX_AUTH_CLAIM];
  if (typeof authClaim !== "object" || authClaim === null) {
    return null;
  }
  return normalizeString((authClaim as Record<string, unknown>)["chatgpt_account_id"]);
}

function readJwtExpiry(token: string | null): number | null {
  const exp = readJwtPayload(token)?.["exp"];
  return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null;
}

function readJwtPayload(token: string | null): Record<string, unknown> | null {
  if (!token) {
    return null;
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf-8"));
    return typeof payload === "object" && payload !== null ? payload as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function preparePiAgentDir(
  baseDir: string | null,
  authEntries: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
): string {
  const baseAuthPath = resolveBasePiAgentAuthPath(env);
  const codexAuthPath = resolveCodexAuthPath(env);
  const cacheKey = [
    baseDir ?? "<none>",
    baseAuthPath ?? "<none>",
    codexAuthPath ?? "<none>",
    readPathSignature(baseDir),
    readPathSignature(baseAuthPath),
    readPathSignature(codexAuthPath),
  ].join("|");
  const cached = preparedPiAgentDirs.get(cacheKey);
  if (cached && existsSync(cached)) {
    return cached;
  }

  const preparedDir = mkdtempSync(join(tmpdir(), "agent-maestro-pi-agent-"));

  if (baseDir) {
    for (const entry of readdirSync(baseDir)) {
      cpSync(join(baseDir, entry), join(preparedDir, entry), { recursive: true });
    }
  }

  writeFileSync(join(preparedDir, PI_AUTH_FILENAME), JSON.stringify(authEntries, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });

  preparedPiAgentDirs.set(cacheKey, preparedDir);
  return preparedDir;
}

function readPathSignature(path: string | null): string {
  if (!path || !existsSync(path)) {
    return "missing";
  }

  const stats = statSync(path);
  return `${stats.size}:${stats.mtimeMs}`;
}
