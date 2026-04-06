import type { ModelTierPolicy } from "./types.js";

export type ModelPresetName = "claude" | "codex";

const MODEL_PRESETS: Record<ModelPresetName, ModelTierPolicy> = {
  claude: {
    curator: {
      primary: "anthropic/claude-opus-4-6",
      fallback: "anthropic/claude-sonnet-4-6",
    },
    lead: {
      primary: "anthropic/claude-opus-4-6",
      fallback: "anthropic/claude-sonnet-4-6",
    },
    worker: {
      primary: "anthropic/claude-sonnet-4-6",
      fallback: "anthropic/claude-haiku-4-6",
    },
  },
  codex: {
    curator: {
      primary: "openai-codex/gpt-5.4",
      fallback: "openai-codex/gpt-5.4-mini",
    },
    lead: {
      primary: "openai-codex/gpt-5.4",
      fallback: "openai-codex/gpt-5.4-mini",
    },
    worker: {
      primary: "openai-codex/gpt-5.4-mini",
      fallback: "openai-codex/gpt-5.4",
    },
  },
};

export function resolveModelPreset(value: string | null | undefined): ModelPresetName | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "config" || normalized === "default") {
    return null;
  }

  if (normalized === "claude" || normalized === "codex") {
    return normalized;
  }

  throw new Error(`Unsupported MAESTRO_MODEL_PRESET '${value}'. Expected one of: claude, codex.`);
}

export function getModelPresetPolicy(preset: ModelPresetName): ModelTierPolicy {
  const policy = MODEL_PRESETS[preset];
  return {
    curator: { ...policy.curator },
    lead: { ...policy.lead },
    worker: { ...policy.worker },
  };
}
