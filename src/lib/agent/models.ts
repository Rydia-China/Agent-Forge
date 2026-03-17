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
  /** Provider key (defaults to "default"). */
  provider?: string;
}

/**
 * Allowed models for the main controller.
 * Order matters — the UI will display them in this order.
 */
export const MODEL_OPTIONS: ModelOption[] = [
  { id: "anthropic/claude-sonnet-4.6", label: "Sonnet", default: true, maxContextTokens: 200_000, inputPricePerM: 3, outputPricePerM: 15 },
  { id: "anthropic/claude-opus-4.6", label: "Opus", maxContextTokens: 200_000, inputPricePerM: 15, outputPricePerM: 75 },
];

/* ---- Derived helpers (do not edit) ---- */

const modelMap = new Map(MODEL_OPTIONS.map((m) => [m.id, m]));

export const DEFAULT_MODEL =
  MODEL_OPTIONS.find((m) => m.default)?.id ?? MODEL_OPTIONS[0]!.id;

/** Returns the model id if it's in the allowed list, otherwise the default. */
export function resolveModel(model: string | undefined): string {
  if (model && modelMap.has(model)) return model;
  return DEFAULT_MODEL;
}

/** Returns the ProviderConfig for a given model id. */
export function getProviderForModel(modelId: string): ProviderConfig {
  const opt = modelMap.get(modelId);
  const key = opt?.provider ?? "default";
  return PROVIDERS[key] ?? PROVIDERS.default!;
}
