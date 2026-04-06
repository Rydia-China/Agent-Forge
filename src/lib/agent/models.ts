/* ------------------------------------------------------------------ */
/*  Model configuration                                                */
/*  Edit this list to add/remove models available in the UI.           */
/* ------------------------------------------------------------------ */

/**
 * Provider key → env-var pair.
 * "default" uses LLM_API_KEY / LLM_BASE_URL.
 * Additional providers add their own env vars.
 */
export interface ProviderConfig {
  apiKeyEnv: string;
  baseUrlEnv: string;
}

export const PROVIDERS: Record<string, ProviderConfig> = {
  default: { apiKeyEnv: "LLM_API_KEY", baseUrlEnv: "LLM_BASE_URL" },
};

export interface ModelOption {
  /** Model ID sent to the LLM provider (e.g. "anthropic/claude-sonnet-4.6"). */
  id: string;
  /** Short display label for the UI. */
  label: string;
  /** Exactly one model should be marked as default. */
  default?: boolean;
  /** Maximum context window size in tokens. */
  maxContextTokens: number;
  /** Price per 1M input tokens (USD). */
  inputPricePerM: number;
  /** Price per 1M output tokens (USD). */
  outputPricePerM: number;
  /** Price per 1M cache-read input tokens (USD). Defaults to inputPricePerM if not set. */
  cacheReadPricePerM?: number;
  /** Provider key (defaults to "default"). */
  provider?: string;
}

/**
 * Allowed models for the main controller.
 * Order matters — the UI will display them in this order.
 */
export const MODEL_OPTIONS: ModelOption[] = [
  { id: "anthropic/claude-sonnet-4.6", label: "Sonnet", default: true, maxContextTokens: 200_000, inputPricePerM: 3, outputPricePerM: 15, cacheReadPricePerM: 0.30 },
  { id: "anthropic/claude-opus-4.6", label: "Opus", maxContextTokens: 200_000, inputPricePerM: 15, outputPricePerM: 75, cacheReadPricePerM: 1.50 },
];

/* ---- Derived helpers (do not edit) ---- */

const modelMap = new Map(MODEL_OPTIONS.map((m) => [m.id, m]));

export const DEFAULT_MODEL =
  MODEL_OPTIONS.find((m) => m.default)?.id ?? MODEL_OPTIONS[0]!.id;

/**
 * Canonical default for subagent (single-shot LLM calls).
 * Always anthropic/claude-sonnet-4.6 — do not change without good reason.
 */
export const SUBAGENT_DEFAULT_MODEL = "anthropic/claude-sonnet-4.6";


/* ------------------------------------------------------------------ */
/*  Model whitelist — strict validation                                */
/*  Exact IDs from MODEL_OPTIONS are always allowed.                   */
/*  Additional allowed prefixes for proxy-routed models below.         */
/* ------------------------------------------------------------------ */

const ALLOWED_PREFIXES: readonly string[] = [
  "openai/gpt-5.4",
  "z-ai/glm-5",
  "x-ai/grok-4.",
  "google/gemini-3.",
];

/** Check if a model id is in the whitelist (exact match or prefix). */
function isAllowedModel(id: string): boolean {
  if (modelMap.has(id)) return true;
  return ALLOWED_PREFIXES.some((prefix) => id.startsWith(prefix));
}

/** Returns the model id if it's in the allowed list, otherwise the default. */
export function resolveModel(model: string | undefined): string {
  if (model && modelMap.has(model)) return model;
  return DEFAULT_MODEL;
}

/**
 * Resolve subagent model with strict whitelist.
 * Unknown/empty → SUBAGENT_DEFAULT_MODEL.
 * Non-whitelisted models throw — callers must handle the error.
 */
export function resolveSubagentModel(model: string | undefined): string {
  if (!model) return SUBAGENT_DEFAULT_MODEL;
  if (isAllowedModel(model)) return model;
  throw new Error(
    `Model "${model}" is not allowed. Use "anthropic/claude-sonnet-4.6" or omit the model field.`,
  );
}


/** Returns the ProviderConfig for a given model id. */
export function getProviderForModel(modelId: string): ProviderConfig {
  const opt = modelMap.get(modelId);
  const key = opt?.provider ?? "default";
  return PROVIDERS[key] ?? PROVIDERS.default!;
}
