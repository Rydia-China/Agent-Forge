import { registry } from "@/lib/mcp/registry";
import { initMcp } from "@/lib/mcp/init";
import {
  chatCompletion,
  mcpToolToOpenAI,
  type LlmMessage,
} from "./llm-client.js";
import { sessionStore } from "./session-store.js";
import { buildSystemPrompt } from "./system-prompt.js";
import type { ChatMessage } from "./types.js";

const MAX_TOOL_ROUNDS = 20;

export interface AgentResponse {
  sessionId: string;
  reply: string;
  messages: ChatMessage[];
}

/**
 * Run the agent tool-use loop.
 *
 * 1. Build system prompt + gather tools
 * 2. Call LLM
 * 3. If tool_calls → execute via MCP Registry → append results → loop
 * 4. If text → return final reply
 */
export async function runAgent(
  userMessage: string,
  sessionId?: string,
): Promise<AgentResponse> {
  await initMcp();

  const session = sessionStore.getOrCreate(sessionId);

  // Build system prompt (fresh each turn to pick up new skills)
  const systemPrompt = await buildSystemPrompt();

  // Append user message
  const userMsg: ChatMessage = { role: "user", content: userMessage };
  session.messages.push(userMsg);

  // Gather tools from registry
  const mcpTools = await registry.listAllTools();
  const openaiTools = mcpTools.map(mcpToolToOpenAI);

  // Build messages for LLM
  const llmMessages: LlmMessage[] = [
    { role: "system", content: systemPrompt },
    ...(session.messages as LlmMessage[]),
  ];

  let rounds = 0;

  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++;

    const completion = await chatCompletion(llmMessages, openaiTools);
    const choice = completion.choices[0];
    if (!choice) throw new Error("No completion choice returned");

    const assistantMsg = choice.message;

    // Store assistant message
    const stored: ChatMessage = {
      role: "assistant",
      content: assistantMsg.content ?? null,
    };
    if (assistantMsg.tool_calls?.length) {
      stored.tool_calls = assistantMsg.tool_calls
        .filter((tc): tc is Extract<typeof tc, { type: "function" }> => tc.type === "function")
        .map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        }));
    }
    session.messages.push(stored);
    llmMessages.push(assistantMsg as LlmMessage);

    // No tool calls → done
    if (!assistantMsg.tool_calls?.length) {
      return {
        sessionId: session.id,
        reply: assistantMsg.content ?? "",
        messages: session.messages,
      };
    }

    // Execute tool calls
    const fnCalls = assistantMsg.tool_calls.filter(
      (tc): tc is Extract<typeof tc, { type: "function" }> => tc.type === "function",
    );
    for (const tc of fnCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        /* invalid JSON, pass empty */
      }

      const result = await registry.callTool(tc.function.name, args);
      const content =
        result.content
          ?.map((c) => ("text" in c ? c.text : JSON.stringify(c)))
          .join("\n") ?? "";

      const toolMsg: ChatMessage = {
        role: "tool",
        tool_call_id: tc.id,
        content,
      };
      session.messages.push(toolMsg);
      llmMessages.push(toolMsg as LlmMessage);
    }
  }

  // Exceeded max rounds — return last assistant content
  return {
    sessionId: session.id,
    reply: "[Agent reached max tool rounds]",
    messages: session.messages,
  };
}
