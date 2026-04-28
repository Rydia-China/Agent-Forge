/* ------------------------------------------------------------------ */
/*  Model configuration                                                */
/*  Edit this list to add/remove models available in the UI.           */
/* ------------------------------------------------------------------ */

export interface ModelOption {
  /** Model ID sent to the LLM provider (e.g. "anthropic/claude-sonnet-4.6"). */
  id: string;
  /** Short display label for the UI. */
  label: string;
  /** Exactly one model should be marked as default. */
  default?: boolean;
}

/**
 * Allowed models for the main controller.
 * Order matters — the UI will display them in this order.
 * 
 * Model IDs must match the API provider's format.
 * For cc-vibe.com: use "claude-sonnet-4-6" (no prefix, hyphens instead of dots).
 * LLM_DEFAULT_MODEL can temporarily override the code default when it matches one
 * of the IDs below.
 */
export const MODEL_OPTIONS: ModelOption[] = [
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6", default: true },
  { id: "claude-opus-4-6", label: "Opus 4.6" },
  { id: "claude-opus-4-7", label: "Opus 4.7" },
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
];

/* ---- Derived helpers (do not edit) ---- */

const modelIds = new Set(MODEL_OPTIONS.map((m) => m.id));

export const DEFAULT_MODEL =
  process.env.LLM_DEFAULT_MODEL && modelIds.has(process.env.LLM_DEFAULT_MODEL)
    ? process.env.LLM_DEFAULT_MODEL
    : MODEL_OPTIONS.find((m) => m.default)?.id ?? MODEL_OPTIONS[0]!.id;

/** Returns the model id if it's in the allowed list, otherwise the default. */
export function resolveModel(model: string | undefined): string {
  if (model && modelIds.has(model)) return model;
  return DEFAULT_MODEL;
}
