import { registry } from "@/lib/mcp/registry";
import { type ToolContext } from "@/lib/mcp/types";
import {
  chatCompletion,
  chatCompletionStream,
  mcpToolToOpenAI,
  type LlmMessage,
} from "./llm-client";
import {
  getOrCreateSession,
  pushMessages,
  stripDanglingToolCalls,
} from "@/lib/services/chat-session-service";
import { buildSystemPrompt } from "./system-prompt";
import { BaseContextProvider, type ContextProvider } from "./context-provider";
import type { ChatMessage, ToolCall } from "./types";
import { uploadDataUrl } from "@/lib/services/oss-service";
import {
  ToolCallTracker,
  scanMessages,
  compressMessages,
} from "./eviction";

/* ------------------------------------------------------------------ */
/*  Key resource extraction from specific tools                        */
/* ------------------------------------------------------------------ */

export interface KeyResourceEvent {
  /** Semantic key — session-unique identifier for upsert. */
  key: string;
  mediaType: "image" | "video" | "json";
  url?: string;
  data?: unknown;
  title?: string;
  /**
   * When set, the resource was already persisted by the MCP tool.
   * subagent-service should only push the SSE event, not call upsertResource.
   */
  persisted?: { id: string; version: number };
}

/**
 * Known tools that produce key resources.
 * Only these tools' results are inspected — all others are ignored.
 */
const KEY_RESOURCE_TOOLS = new Set([
  "subagent__run_text",
]);

/**
 * Extract key resource events from a specific tool's result.
 * Only known resource-producing tools are handled.
 */
export function extractKeyResources(toolName: string, content: string): KeyResourceEvent[] {
  if (!KEY_RESOURCE_TOOLS.has(toolName)) return [];

  const out: KeyResourceEvent[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return out;
  }
  if (!Array.isArray(parsed)) return out;

  for (const item of parsed) {
    if (!isRecord(item) || item.status !== "ok") continue;

    if (toolName === "subagent__run_text") {
      // Subagent: { status, result, keyJsonTitle? }
      if (typeof item.keyJsonTitle !== "string" || typeof item.result !== "string") continue;
      let data: unknown;
      try { data = JSON.parse(item.result as string); } catch { data = item.result; }
      out.push({
        key: item.keyJsonTitle as string,
        mediaType: "json",
        data,
        title: item.keyJsonTitle as string,
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Agent configuration                                                */
/* ------------------------------------------------------------------ */

/**
 * Optional configuration for the agent loop.
 * When provided, enables domain-specific context refresh, MCP pre-loading,
 * and skill injection — without forking the core loop.
 */
export interface AgentConfig {
  /** Dynamic context provider — called every iteration to refresh context. */
  contextProvider?: ContextProvider;
  /** Skill names whose full content should be injected into the system prompt. */
  skills?: string[];
  /** Optional MCP provider scope. Omit to expose all registered providers. */
  mcpScope?: string[];
  /** LLM model id to use for this run (must be in MODEL_OPTIONS). */
  model?: string;
}


/* ------------------------------------------------------------------ */
/*  Per-session concurrency lock                                       */
/*  Sessions are ephemeral — a simple in-memory mutex is sufficient.   */
/* ------------------------------------------------------------------ */

const sessionLocks = new Map<string, Promise<unknown>>();

function withSessionLock<T>(sid: string, fn: () => Promise<T>): Promise<T> {
  const prev = sessionLocks.get(sid) ?? Promise.resolve();
  const next = prev.then(fn, fn);          // run fn after previous settles
  sessionLocks.set(sid, next);
  const cleanup = () => {
    // clean up if we're still the tail of the chain
    if (sessionLocks.get(sid) === next) sessionLocks.delete(sid);
  };
  void next.then(cleanup, cleanup);
  return next;
}
export interface AgentInterruption {
  recoverable: true;
  reason: string;
  partialSaved: boolean;
  code?: string;
}

export interface AgentResponse {
  sessionId: string;
  reply: string;
  messages: ChatMessage[];
  interruption?: AgentInterruption;
}

export interface ToolStartEvent {
  callId: string;
  name: string;
  index: number;
  total: number;
}

export interface ToolEndEvent {
  callId: string;
  name: string;
  durationMs: number;
  error?: string;
}

export interface StreamCallbacks {
  onSession?: (sessionId: string) => void;
  onDelta?: (text: string) => void;
  onToolCall?: (call: ToolCall) => void;
  onToolStart?: (event: ToolStartEvent) => void;
  onToolEnd?: (event: ToolEndEvent) => void;
  onUploadRequest?: (req: unknown) => void;
  onKeyResource?: (resource: KeyResourceEvent) => void;
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
  config?: AgentConfig,
): Promise<AgentResponse> {
  const session = await getOrCreateSession(sessionId, userName);
  return withSessionLock(session.id, () => runAgentInner(userMessage, session, userName, images, config));
}

export async function runAgentStream(
  userMessage: string,
  sessionId: string | undefined,
  userName: string | undefined,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  images?: string[],
  config?: AgentConfig,
): Promise<AgentResponse> {
  const session = await getOrCreateSession(sessionId, userName);
  callbacks.onSession?.(session.id);
  return withSessionLock(session.id, () =>
    runAgentStreamInner(userMessage, session, userName, callbacks, signal, images, config),
  );
}

/* ------------------------------------------------------------------ */
/*  Image resolution: data URL → OSS HTTP URL                          */
/* ------------------------------------------------------------------ */

/**
 * Resolve images: upload any base64 data URLs to OSS and return HTTP URLs.
 * Already-HTTP URLs pass through unchanged.
 * Upload failures throw — the caller should surface the error to the user
 * so they can retry, because the main model never receives image content
 * directly and a lost image cannot be recovered.
 */
async function resolveImages(images: string[]): Promise<string[]> {
  const results = await Promise.all(
    images.map(async (img, idx) => {
      if (!img.startsWith("data:")) return img;
      try {
        return await uploadDataUrl(img, "chat-images");
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(`图片 ${idx + 1} 上传失败，请重新发送: ${reason}`);
      }
    }),
  );
  return results;
}

/* ------------------------------------------------------------------ */
/*  ChatMessage → LlmMessage conversion                                */
/* ------------------------------------------------------------------ */

/**
 * Convert a ChatMessage to an LlmMessage.
 *
 * Images are NEVER sent as vision content (image_url blocks).
 * Instead, URLs are appended as plain text so the main model knows
 * which images are attached and can delegate to a subagent for
 * visual understanding when needed.
 */
function chatMsgToLlm(msg: ChatMessage): LlmMessage {
  if (msg.images?.length) {
    const userText = msg.content ?? "";
    const imageMap = msg.images
      .map((url, i) => `- image_${i + 1}: ${url}`)
      .join("\n");
    const annotation =
      `[${msg.images.length} 张图片已附加]\n${imageMap}\n如需理解图片内容，请使用 subagent 工具查看`;
    const fullText = userText
      ? `${userText}\n\n${annotation}`
      : annotation;

    return {
      role: msg.role as "user",
      content: fullText,
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

async function listAgentTools(config?: AgentConfig) {
  if (config?.mcpScope?.length) {
    return registry.listToolsForProviders(config.mcpScope);
  }
  return registry.listAllTools();
}

async function runAgentInner(
  userMessage: string,
  session: { id: string; messages: ChatMessage[] },
  userName: string | undefined,
  images?: string[],
  config?: AgentConfig,
): Promise<AgentResponse> {
  const toolCtx: ToolContext = { sessionId: session.id, userName };
  return runAgentInnerCore(userMessage, session, toolCtx, images, config);
}

async function runAgentInnerCore(
  userMessage: string,
  session: { id: string; messages: ChatMessage[] },
  toolCtx: ToolContext,
  images?: string[],
  config?: AgentConfig,
): Promise<AgentResponse> {
  const systemPrompt = await buildSystemPrompt(config?.skills);
  const ctxProvider = config?.contextProvider ?? new BaseContextProvider(
    toolCtx.sessionId ? { scopeType: "session", scopeId: toolCtx.sessionId } : undefined,
  );

  // --- Eviction setup (compression only; recall reads from DB) ---
  const tracker = new ToolCallTracker();
  scanMessages(session.messages, tracker);

  // Resolve images: data URLs → OSS HTTP URLs
  const resolvedImages = images?.length ? await resolveImages(images) : undefined;

  const userMsg: ChatMessage = { role: "user", content: userMessage };
  if (resolvedImages?.length) userMsg.images = resolvedImages;
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

  while (true) {
    // Build system state context (refreshed every iteration)
    const stateCtx = await ctxProvider.build();

    // Rebuild compressed LLM context each iteration
    const allRaw = [...session.messages, ...newMessages];
    const compressed = compressMessages(allRaw, tracker);
    const llmMessages: LlmMessage[] = [
      { role: "system", content: systemPrompt },
      // Context pair: only present when ContextProvider returns state
      ...(stateCtx
        ? [
            { role: "assistant" as const, content: "当前系统最新状态是什么？" },
            { role: "user" as const, content: `[real-time system state — 以此为准]\n${stateCtx}` },
          ]
        : []),
      ...compressed.map(chatMsgToLlm),
    ];

    const mcpTools = await listAgentTools(config);
    const openaiTools = mcpTools.map(mcpToolToOpenAI);

    const completion = await chatCompletion(llmMessages, openaiTools, config?.model);
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
    for (let i = 0; i < fnCalls.length; i++) {
      const tc = fnCalls[i]!;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        /* invalid JSON, pass empty */
      }

      const result = await registry.callTool(tc.function.name, args, toolCtx);
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
const RECOVERABLE_NETWORK_CODES = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNABORTED",
  "EPIPE",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_DESTROYED",
]);

function getStringField(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const raw = value[key];
  if (typeof raw === "string" && raw.trim().length > 0) return raw;
  if (typeof raw === "number") return String(raw);
  return undefined;
}

function errorChain(err: unknown): unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current: unknown = err;
  for (let i = 0; i < 8; i++) {
    if (current === undefined || current === null || seen.has(current)) break;
    chain.push(current);
    seen.add(current);
    if (!isRecord(current) || !("cause" in current)) break;
    current = current.cause;
  }
  return chain;
}

function classifyRecoverableLlmStreamError(err: unknown): Omit<AgentInterruption, "partialSaved"> | null {
  const chain = errorChain(err);
  const names: string[] = [];
  const messages: string[] = [];
  const codes: string[] = [];

  for (const item of chain) {
    const name = getStringField(item, "name");
    const message = item instanceof Error ? item.message : getStringField(item, "message");
    const code = getStringField(item, "code");

    if (name) names.push(name);
    if (message) messages.push(message);
    if (code) codes.push(code);
  }

  const matchedCode = codes.find((code) => RECOVERABLE_NETWORK_CODES.has(code));
  if (matchedCode) {
    return {
      recoverable: true,
      reason: "LLM stream interrupted by a transient network error. Partial context has been saved.",
      code: matchedCode,
    };
  }

  const combinedNames = names.join(" ").toLowerCase();
  if (
    combinedNames.includes("apiconnectiontimeouterror") ||
    combinedNames.includes("apiconnectionerror") ||
    combinedNames.includes("timeouterror")
  ) {
    return {
      recoverable: true,
      reason: "LLM stream interrupted by a transient connection error. Partial context has been saved.",
    };
  }

  const combinedMessages = messages.join(" ").toLowerCase();
  if (
    combinedMessages.includes("read etimedout") ||
    combinedMessages.includes("socket hang up") ||
    combinedMessages.includes("fetch failed") ||
    combinedMessages.includes("network") ||
    combinedMessages.includes("terminated")
  ) {
    return {
      recoverable: true,
      reason: "LLM stream interrupted before completion. Partial context has been saved.",
    };
  }

  return null;
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
  userName: string | undefined,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  images?: string[],
  config?: AgentConfig,
): Promise<AgentResponse> {
  const toolCtx: ToolContext = { sessionId: session.id, userName };
  return runAgentStreamInnerCore(userMessage, session, toolCtx, callbacks, signal, images, config);
}

async function runAgentStreamInnerCore(
  userMessage: string,
  session: { id: string; messages: ChatMessage[] },
  toolCtx: ToolContext,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  images?: string[],
  config?: AgentConfig,
): Promise<AgentResponse> {
  const systemPrompt = await buildSystemPrompt(config?.skills);
  const ctxProvider = config?.contextProvider ?? new BaseContextProvider(
    toolCtx.sessionId ? { scopeType: "session", scopeId: toolCtx.sessionId } : undefined,
  );

  const tracker = new ToolCallTracker();
  scanMessages(session.messages, tracker);

  // Resolve images: data URLs → OSS HTTP URLs
  const resolvedImages = images?.length ? await resolveImages(images) : undefined;

  const userMsg: ChatMessage = { role: "user", content: userMessage };
  if (resolvedImages?.length) userMsg.images = resolvedImages;
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

  while (true) {
    if (signal?.aborted) break;

    // Build system state context (refreshed every iteration)
    const stateCtx = await ctxProvider.build();

    // Rebuild compressed LLM context each iteration
    const allRaw = [...session.messages, ...newMessages];
    const compressed = compressMessages(allRaw, tracker);
    const llmMessages: LlmMessage[] = [
      { role: "system", content: systemPrompt },
      // Context pair: only present when ContextProvider returns state
      ...(stateCtx
        ? [
            { role: "assistant" as const, content: "当前系统最新状态是什么？" },
            { role: "user" as const, content: `[real-time system state — 以此为准]\n${stateCtx}` },
          ]
        : []),
      ...compressed.map(chatMsgToLlm),
    ];

    const mcpTools = await listAgentTools(config);
    const openaiTools = mcpTools.map(mcpToolToOpenAI);

    if (mcpTools.length === 0) {
      console.warn(`[agent:stream] WARNING: No tools available! Agent cannot use any tools.`);
    }

    let currentContent = "";

    let phase: "llm" | "tools" = "llm";

    try {
      const stream = await chatCompletionStream(llmMessages, openaiTools, signal, config?.model);
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
      phase = "tools";

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

      for (let i = 0; i < toolCalls.length; i++) {
        const tc = toolCalls[i]!;
        if (signal?.aborted) break;
        callbacks.onToolCall?.(tc);
        callbacks.onToolStart?.({
          callId: tc.id, name: tc.function.name,
          index: i, total: toolCalls.length,
        });

        let args: Record<string, unknown> = {};
        try {
          const parsed: unknown = JSON.parse(tc.function.arguments);
          if (isRecord(parsed)) args = parsed;
        } catch {
          /* invalid JSON, pass empty */
        }

        const t0 = Date.now();
        let toolError: string | undefined;
        try {
          const result = await registry.callTool(tc.function.name, args, toolCtx);

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

          // Extract key resources from known resource-producing tools
          for (const kr of extractKeyResources(tc.function.name, content)) {
            callbacks.onKeyResource?.(kr);
          }

          const toolMsg: ChatMessage = {
            role: "tool",
            tool_call_id: tc.id,
            content,
          };
          newMessages.push(toolMsg);
        } catch (toolErr: unknown) {
          toolError = toolErr instanceof Error ? toolErr.message : String(toolErr);
          throw toolErr;
        } finally {
          callbacks.onToolEnd?.({
            callId: tc.id, name: tc.function.name,
            durationMs: Date.now() - t0, error: toolError,
          });
        }
      }

      // If aborted mid-execution, strip unmatched tool_calls so
      // the persisted context stays valid for future LLM calls.
      if (signal?.aborted) {
        stripDanglingToolCalls(newMessages);
        await flush();
        break;
      }

      // Flush assistant + tool messages so recall can find them
      await flush();
    } catch (err: unknown) {
      if (signal?.aborted) {
        console.warn(`[agent:stream] Stream aborted; persisting partial context.`);
        // Strip dangling tool_calls that were accumulated before abort
        stripDanglingToolCalls(newMessages);
        if (currentContent && !newMessages.some(
          (m) => m.role === "assistant" && m.content === currentContent,
        )) {
          lastReply = currentContent;
          newMessages.push({ role: "assistant", content: currentContent });
        }
        break;
      }
      if (phase === "llm") {
        const interruption = classifyRecoverableLlmStreamError(err);
        if (interruption) {
          console.warn(`[agent:stream] Recoverable stream interruption:`, err);
          stripDanglingToolCalls(newMessages);
          if (currentContent && !newMessages.some(
            (m) => m.role === "assistant" && m.content === currentContent,
          )) {
            lastReply = currentContent;
            newMessages.push({ role: "assistant", content: currentContent });
          }
          await flush();
          const allMessages = [...session.messages, ...newMessages];
          return {
            sessionId: session.id,
            reply: currentContent || lastReply,
            messages: allMessages,
            interruption: {
              ...interruption,
              partialSaved: true,
            },
          };
        }
      }
      console.error(`[agent:stream] Stream error:`, err);
      throw err;
    }
  }

  // Abort path: persist whatever we accumulated
  stripDanglingToolCalls(newMessages);
  await flush();
  const allMessages = [...session.messages, ...newMessages];
  return {
    sessionId: session.id,
    reply: lastReply,
    messages: allMessages,
  };
}
