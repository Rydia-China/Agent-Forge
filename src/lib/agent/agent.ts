import { registry } from "@/lib/mcp/registry";
import { initMcp } from "@/lib/mcp/init";
import {
  chatCompletion,
  mcpToolToOpenAI,
  type LlmMessage,
} from "./llm-client";
import {
  getOrCreateSession,
  pushMessages,
} from "@/lib/services/chat-session-service";
import { buildSystemPrompt } from "./system-prompt";
import type { ChatMessage } from "./types";

/* ------------------------------------------------------------------ */
/*  Per-session concurrency lock                                       */
/*  Sessions are ephemeral — a simple in-memory mutex is sufficient.   */
/* ------------------------------------------------------------------ */

const sessionLocks = new Map<string, Promise<unknown>>();

function withSessionLock<T>(sid: string, fn: () => Promise<T>): Promise<T> {
  const prev = sessionLocks.get(sid) ?? Promise.resolve();
  const next = prev.then(fn, fn);          // run fn after previous settles
  sessionLocks.set(sid, next);
  void next.finally(() => {
    // clean up if we're still the tail of the chain
    if (sessionLocks.get(sid) === next) sessionLocks.delete(sid);
  });
  return next;
}

export interface AgentResponse {
  sessionId: string;
  reply: string;
  messages: ChatMessage[];
}

/**
 * Run the agent tool-use loop.
 *
 * 1. Load / create session from DB
 * 2. Build system prompt + gather tools
 * 3. Call LLM
 * 4. If tool_calls → execute via MCP Registry → append results → loop
 * 5. If text → persist new messages to DB → return final reply
 */
export async function runAgent(
  userMessage: string,
  sessionId?: string,
  userName?: string,
): Promise<AgentResponse> {
  await initMcp();

  const session = await getOrCreateSession(sessionId, userName);
  return withSessionLock(session.id, () => runAgentInner(userMessage, session));
}

async function runAgentInner(
  userMessage: string,
  session: { id: string; messages: ChatMessage[] },
): Promise<AgentResponse> {
  // Build system prompt (fresh each turn to pick up new skills)
  const systemPrompt = await buildSystemPrompt();

  // User message (will be persisted at the end)
  const userMsg: ChatMessage = { role: "user", content: userMessage };
  const newMessages: ChatMessage[] = [userMsg];

  // Gather tools from registry
  const mcpTools = await registry.listAllTools();
  const openaiTools = mcpTools.map(mcpToolToOpenAI);

  // Build messages for LLM (history from DB + new user message)
  const llmMessages: LlmMessage[] = [
    { role: "system", content: systemPrompt },
    ...(session.messages as LlmMessage[]),
    userMsg as LlmMessage,
  ];

  // eslint-disable-next-line no-constant-condition
  while (true) {

    const completion = await chatCompletion(llmMessages, openaiTools);
    const choice = completion.choices[0];
    if (!choice) throw new Error("No completion choice returned");

    const assistantMsg = choice.message;

    // Build storable assistant message
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
    newMessages.push(stored);
    llmMessages.push(assistantMsg as LlmMessage);

    // No tool calls → persist & return
    if (!assistantMsg.tool_calls?.length) {
      await pushMessages(session.id, newMessages);
      const allMessages = [...session.messages, ...newMessages];
      return {
        sessionId: session.id,
        reply: assistantMsg.content ?? "",
        messages: allMessages,
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
          ?.map((c: Record<string, unknown>) => ("text" in c ? String(c.text) : JSON.stringify(c)))
          .join("\n") ?? "";

      const toolMsg: ChatMessage = {
        role: "tool",
        tool_call_id: tc.id,
        content,
      };
      newMessages.push(toolMsg);
      llmMessages.push(toolMsg as LlmMessage);
    }
  }

}
