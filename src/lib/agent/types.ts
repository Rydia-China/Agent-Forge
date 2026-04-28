/** OpenAI-compatible tool call */
export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface ProviderMetadata {
  /** OpenAI-compatible thinking models such as DeepSeek may require this on follow-up turns. */
  reasoning_content?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  providerMetadata?: ProviderMetadata;
  images?: string[];
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  hidden?: boolean;
}
