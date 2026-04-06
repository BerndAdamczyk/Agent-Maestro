import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PI_LOOKUP_COMMAND = "command -v pi";

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

export function getForwardedProviderEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const forwarded: Record<string, string> = {};

  for (const key of FORWARDED_PROVIDER_ENV_KEYS) {
    const value = env[key];
    if (typeof value === "string" && value.trim() !== "") {
      forwarded[key] = value;
    }
  }

  return forwarded;
}

export function resolvePiAgentDir(env: NodeJS.ProcessEnv = process.env): string | null {
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
  const agentDir = resolvePiAgentDir(env);
  if (!agentDir) {
    return {};
  }

  const authPath = join(agentDir, "auth.json");
  if (!existsSync(authPath)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(authPath, "utf-8"));
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
