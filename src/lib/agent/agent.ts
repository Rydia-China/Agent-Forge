import { registry } from "@/lib/mcp/registry";
import { initMcp } from "@/lib/mcp/init";
import {
  chatCompletion,
  chatCompletionStream,
  mcpToolToOpenAI,
  type LlmMessage,
} from "./llm-client";
import {
  getOrCreateSession,
  pushMessages,
} from "@/lib/services/chat-session-service";
import { buildSystemPrompt } from "./system-prompt";
import type { ChatMessage, ToolCall } from "./types";
import {
  ToolCallTracker,
  scanMessages,
  compressMessages,
} from "./eviction";
import { requestContext } from "@/lib/request-context";

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

export interface StreamCallbacks {
  onSession?: (sessionId: string) => void;
  onDelta?: (text: string) => void;
  onToolCall?: (call: ToolCall) => void;
  onUploadRequest?: (req: unknown) => void;
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
  images?: string[],
): Promise<AgentResponse> {
  await initMcp();

  const session = await getOrCreateSession(sessionId, userName);
  return withSessionLock(session.id, () => runAgentInner(userMessage, session, images));
}

export async function runAgentStream(
  userMessage: string,
  sessionId: string | undefined,
  userName: string | undefined,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  images?: string[],
): Promise<AgentResponse> {
  await initMcp();
  const session = await getOrCreateSession(sessionId, userName);
  callbacks.onSession?.(session.id);
  return withSessionLock(session.id, () =>
    runAgentStreamInner(userMessage, session, callbacks, signal, images),
  );
}

/**
 * Convert a ChatMessage to an LlmMessage, building multi-part content
 * when images are present (OpenAI vision format).
 */
function chatMsgToLlm(msg: ChatMessage): LlmMessage {
  if (msg.images?.length && msg.content) {
    return {
      role: msg.role as "user",
      content: [
        { type: "text" as const, text: msg.content },
        ...msg.images.map((url) => ({
          type: "image_url" as const,
          image_url: { url },
        })),
      ],
    };
  }
  const base: Record<string, unknown> = {
    role: msg.role,
    content: msg.content ?? null,
  };
  if (msg.tool_calls?.length) base.tool_calls = msg.tool_calls;
  if (msg.tool_call_id) base.tool_call_id = msg.tool_call_id;
  return base as unknown as LlmMessage;
}

async function runAgentInner(
  userMessage: string,
  session: { id: string; messages: ChatMessage[] },
  images?: string[],
): Promise<AgentResponse> {
  // Wrap with sessionId in request context (needed by memory__recall)
  const parentStore = requestContext.getStore() ?? {};
  return requestContext.run(
    { ...parentStore, sessionId: session.id },
    () => runAgentInnerCore(userMessage, session, images),
  );
}

async function runAgentInnerCore(
  userMessage: string,
  session: { id: string; messages: ChatMessage[] },
  images?: string[],
): Promise<AgentResponse> {
  const systemPrompt = await buildSystemPrompt();

  // --- Eviction setup (compression only; recall reads from DB) ---
  const tracker = new ToolCallTracker();
  scanMessages(session.messages, tracker);

  const userMsg: ChatMessage = { role: "user", content: userMessage };
  if (images?.length) userMsg.images = images;
  const newMessages: ChatMessage[] = [userMsg];
  let persistedCount = 0;

  /** Flush un-persisted messages to DB so recall can find them. */
  async function flush(): Promise<void> {
    const batch = newMessages.slice(persistedCount);
    if (batch.length > 0) {
      await pushMessages(session.id, batch);
      persistedCount = newMessages.length;
    }
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // Rebuild compressed LLM context each iteration
    const allRaw = [...session.messages, ...newMessages];
    const compressed = compressMessages(allRaw, tracker);
    const llmMessages: LlmMessage[] = [
      { role: "system", content: systemPrompt },
      ...compressed.map(chatMsgToLlm),
    ];

    const mcpTools = await registry.listAllTools();
    const openaiTools = mcpTools.map(mcpToolToOpenAI);

    const completion = await chatCompletion(llmMessages, openaiTools);
    const choice = completion.choices[0];
    if (!choice) throw new Error("No completion choice returned");

    const assistantMsg = choice.message;

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

    if (!assistantMsg.tool_calls?.length) {
      await flush();
      const allMessages = [...session.messages, ...newMessages];
      return {
        sessionId: session.id,
        reply: assistantMsg.content ?? "",
        messages: allMessages,
      };
    }

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

      // Register with eviction tracker
      tracker.register(tc.id, tc.function.name, tc.function.arguments, content);

      const toolMsg: ChatMessage = {
        role: "tool",
        tool_call_id: tc.id,
        content,
      };
      newMessages.push(toolMsg);
    }

    // Flush assistant + tool messages so recall can find them
    await flush();
  }
}

interface ToolCallDelta {
  index?: number;
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function upsertToolCall(
  map: Map<number, ToolCall>,
  delta: ToolCallDelta,
): void {
  const index = delta.index;
  if (typeof index !== "number") return;

  const existing: ToolCall = map.get(index) ?? {
    id: delta.id ?? `call_${index}`,
    type: "function",
    function: { name: "", arguments: "" },
  };

  if (delta.id) existing.id = delta.id;
  if (delta.function?.name) existing.function.name = delta.function.name;
  if (delta.function?.arguments) {
    existing.function.arguments += delta.function.arguments;
  }

  map.set(index, existing);
}

async function runAgentStreamInner(
  userMessage: string,
  session: { id: string; messages: ChatMessage[] },
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  images?: string[],
): Promise<AgentResponse> {
  const parentStore = requestContext.getStore() ?? {};
  return requestContext.run(
    { ...parentStore, sessionId: session.id },
    () => runAgentStreamInnerCore(userMessage, session, callbacks, signal, images),
  );
}

async function runAgentStreamInnerCore(
  userMessage: string,
  session: { id: string; messages: ChatMessage[] },
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  images?: string[],
): Promise<AgentResponse> {
  const systemPrompt = await buildSystemPrompt();

  const tracker = new ToolCallTracker();
  scanMessages(session.messages, tracker);

  const userMsg: ChatMessage = { role: "user", content: userMessage };
  if (images?.length) userMsg.images = images;
  const newMessages: ChatMessage[] = [userMsg];
  let persistedCount = 0;

  /** Flush un-persisted messages to DB so recall can find them. */
  async function flush(): Promise<void> {
    const batch = newMessages.slice(persistedCount);
    if (batch.length > 0) {
      await pushMessages(session.id, batch);
      persistedCount = newMessages.length;
    }
  }

  let lastReply = "";

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (signal?.aborted) break;

    // Rebuild compressed LLM context each iteration
    const allRaw = [...session.messages, ...newMessages];
    const compressed = compressMessages(allRaw, tracker);
    const llmMessages: LlmMessage[] = [
      { role: "system", content: systemPrompt },
      ...compressed.map(chatMsgToLlm),
    ];

    const mcpTools = await registry.listAllTools();
    const openaiTools = mcpTools.map(mcpToolToOpenAI);

    let currentContent = "";

    try {
      const stream = await chatCompletionStream(llmMessages, openaiTools, signal);
      const toolCallsByIndex = new Map<number, ToolCall>();

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) continue;
        const delta = choice.delta;
        if (delta.content) {
          currentContent += delta.content;
          callbacks.onDelta?.(delta.content);
        }
        if (delta.tool_calls?.length) {
          for (const tcDelta of delta.tool_calls) {
            upsertToolCall(toolCallsByIndex, tcDelta);
          }
        }
      }

      lastReply = currentContent;

      const toolCalls = Array.from(toolCallsByIndex.entries())
        .sort((a, b) => a[0] - b[0])
        .map((entry) => entry[1]);

      const stored: ChatMessage = {
        role: "assistant",
        content: currentContent ? currentContent : null,
      };
      if (toolCalls.length > 0) {
        stored.tool_calls = toolCalls;
      }
      newMessages.push(stored);

      if (toolCalls.length === 0) {
        await flush();
        const allMessages = [...session.messages, ...newMessages];
        return {
          sessionId: session.id,
          reply: currentContent,
          messages: allMessages,
        };
      }

      for (const tc of toolCalls) {
        if (signal?.aborted) break;
        callbacks.onToolCall?.(tc);
        let args: Record<string, unknown> = {};
        try {
          const parsed: unknown = JSON.parse(tc.function.arguments);
          if (isRecord(parsed)) args = parsed;
        } catch {
          /* invalid JSON, pass empty */
        }

        const result = await registry.callTool(tc.function.name, args);

        // Side-channel: upload provider attaches _uploadRequest
        const uploadReq = (result as Record<string, unknown>)._uploadRequest;
        if (uploadReq) {
          callbacks.onUploadRequest?.(uploadReq);
        }

        const content =
          result.content
            ?.map((c: Record<string, unknown>) =>
              "text" in c ? String(c.text) : JSON.stringify(c),
            )
            .join("\n") ?? "";

        // Register with eviction tracker
        tracker.register(tc.id, tc.function.name, tc.function.arguments, content);

        const toolMsg: ChatMessage = {
          role: "tool",
          tool_call_id: tc.id,
          content,
        };
        newMessages.push(toolMsg);
      }

      // Flush assistant + tool messages so recall can find them
      await flush();
    } catch (err: unknown) {
      if (signal?.aborted) {
        if (currentContent) {
          lastReply = currentContent;
          newMessages.push({ role: "assistant", content: currentContent });
        }
        break;
      }
      throw err;
    }
  }

  // Abort path: persist whatever we accumulated
  await flush();
  const allMessages = [...session.messages, ...newMessages];
  return {
    sessionId: session.id,
    reply: lastReply,
    messages: allMessages,
  };
}
