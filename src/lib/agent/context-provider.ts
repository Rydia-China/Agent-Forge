/**
 * ContextProvider — generic interface for dynamic context injection.
 *
 * An agent runner can accept an optional ContextProvider. Before each LLM call,
 * it calls `build()` to get the latest context string, which is prepended to the
 * system prompt. This enables per-iteration state refresh without modifying the
 * core agent loop.
 */
export interface ContextProvider {
  /**
   * Build the current context string.
   * Called before every LLM invocation — must return fresh data each time.
   * The returned string is injected at the top of the system prompt.
   */
  build(): Promise<string>;
}
