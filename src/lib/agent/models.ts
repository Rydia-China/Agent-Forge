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
  { id: "anthropic/claude-sonnet-4.6", label: "Sonnet", default: true, maxContextTokens: 1_000_000, inputPricePerM: 3, outputPricePerM: 15, cacheReadPricePerM: 0.30 },
  { id: "anthropic/claude-opus-4.6", label: "Opus", maxContextTokens: 1_000_000, inputPricePerM: 15, outputPricePerM: 75, cacheReadPricePerM: 1.50 },
];

/* ---- Derived helpers (do not edit) ---- */

const modelMap = new Map(MODEL_OPTIONS.map((m) => [m.id, m]));

export const DEFAULT_MODEL =
  MODEL_OPTIONS.find((m) => m.default)?.id ?? MODEL_OPTIONS[0]!.id;

/**
 * Canonical default for subagent (single-shot LLM calls).
 * Always anthropic/claude-sonnet-4.6 — do not change without good reason.
 * @deprecated Use `resolveModelByType()` instead.
 */
export const SUBAGENT_DEFAULT_MODEL = "anthropic/claude-sonnet-4.6";

/* ------------------------------------------------------------------ */
/*  Usage-type based model routing                                     */
/* ------------------------------------------------------------------ */

/**
 * Categorises an LLM call so the system can pick the right default model.
 *
 * - "task-execution"   — subagent tool-loop (multi-step business ops)
 * - "prompt-execution" — subagent single-shot (Langfuse compiled prompts)
 * - "controller"       — main chat controller
 * - "utility"          — title generation, context compression, etc.
 */
export type ModelUsageType =
  | "task-execution"
  | "prompt-execution"
  | "controller"
  | "utility";

/** Env-var name per usage type (undefined = no env override for that type). */
const USAGE_TYPE_ENV: Record<ModelUsageType, string | undefined> = {
  "task-execution": "MODEL_TASK_EXECUTION",
  "prompt-execution": "MODEL_PROMPT_EXECUTION",
  controller: undefined,
  utility: undefined,
};

/** Hard-coded defaults per usage type. */
const MODEL_DEFAULTS: Record<ModelUsageType, string> = {
  "task-execution": "anthropic/claude-sonnet-4.6",
  "prompt-execution": "z-ai/glm-5-turbo",
  controller: DEFAULT_MODEL,
  utility: DEFAULT_MODEL,
};

/**
 * Resolve a model by usage type with optional explicit override.
 *
 * Priority:
 *   1. `explicit` (caller / user / skill specified) — whitelist-checked
 *   2. Env var for the usage type (e.g. MODEL_TASK_EXECUTION)
 *   3. Hard-coded MODEL_DEFAULTS[type]
 *   4. Fallback to DEFAULT_MODEL
 */
export function resolveModelByType(
  type: ModelUsageType,
  explicit?: string,
): string {
  // 1. Explicit override — must pass whitelist
  if (explicit) {
    if (isAllowedModel(explicit)) return explicit;
    console.warn(
      `[models] Explicit model "${explicit}" not allowed, falling back to type default`,
    );
  }

  // 2. Env override
  const envKey = USAGE_TYPE_ENV[type];
  if (envKey) {
    const envVal = process.env[envKey];
    if (envVal && isAllowedModel(envVal)) return envVal;
  }

  // 3. Hard-coded type default
  return MODEL_DEFAULTS[type];
}


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
 *
 * @deprecated Use `resolveModelByType()` for new code.
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
