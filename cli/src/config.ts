/**
 * CLI configuration — all values from environment variables.
 * Loaded once at startup via dotenv, read lazily on first access.
 */

export const config = {
  /** Subagent task execution model. */
  get modelTaskExecution(): string {
    return process.env.MODEL_TASK_EXECUTION ?? "x-ai/grok-4.1-fast-non-reasoning";
  },

  /** Prompt compilation/execution model. */
  get modelPromptExecution(): string {
    return process.env.MODEL_PROMPT_EXECUTION ?? "z-ai/glm-5-turbo";
  },

  /** Main controller model (used as judge default). */
  get modelController(): string {
    return process.env.MODEL_CONTROLLER ?? "anthropic/claude-sonnet-4.6";
  },

  /** Agent-Forge API base URL (for trace/workflow/regression modes). */
  get apiUrl(): string {
    const port = process.env.PORT ?? "8001";
    return process.env.FORGE_API_URL ?? `http://localhost:${port}`;
  },

  /** LLM API key. */
  get llmApiKey(): string {
    return process.env.LLM_API_KEY ?? "";
  },

  /** LLM API base URL. */
  get llmBaseUrl(): string | undefined {
    return process.env.LLM_BASE_URL || undefined;
  },
};
