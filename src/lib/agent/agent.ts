import { registry } from "@/lib/mcp/registry";
import { initMcp } from "@/lib/mcp/init";
import type { ToolContext } from "@/lib/mcp/types";
import {
  chatCompletion,
  chatCompletionStream,
  isTransientStreamError,
  mcpToolToOpenAI,
  type LlmMessage,
} from "./llm-client";
import { resolveModel, MODEL_OPTIONS } from "./models";
import {
  getOrCreateSession,
  pushMessages,
  replaceMessages,
  stripDanglingToolCalls,
} from "@/lib/services/chat-session-service";
import { buildSystemPrompt } from "./system-prompt";
import { compressToCheckpoint, CHECKPOINT_THRESHOLD } from "./context-checkpoint";
import type { ChatMessage, ToolCall } from "./types";
import { uploadDataUrl } from "@/lib/services/oss-service";

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
   * task-service should only push the SSE event, not call upsertResource.
   */
  persisted?: { id: string; version: number };
}

/**
 * Known tools that produce key resources.
 * Only these tools' results are inspected — all others are ignored.
 */
const KEY_RESOURCE_TOOLS = new Set([
  "subagent__run",
  "video_workflow__generate_portrait",
  "video_workflow__generate_scene",
  "video_workflow__generate_costume",
  "video_workflow__generate_video",
]);

/**
 * Extract key resource events from a specific tool's result.
 * Inspects video_workflow image/video tools + subagent.
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

  // video_workflow tools return a single object, not an array
  const items = Array.isArray(parsed) ? parsed : [parsed];

  for (const item of items) {
    if (!isRecord(item) || item.status !== "ok") continue;

    if (toolName === "subagent__run") {
      if (typeof item.keyJsonTitle !== "string" || typeof item.result !== "string") continue;
      let data: unknown;
      try { data = JSON.parse(item.result as string); } catch { data = item.result; }
      out.push({
        key: item.keyJsonTitle as string,
        mediaType: "json",
        data,
        title: item.keyJsonTitle as string,
      });
    } else if (
      toolName === "video_workflow__generate_portrait" ||
      toolName === "video_workflow__generate_scene" ||
      toolName === "video_workflow__generate_costume"
    ) {
      // Image tools: { status, key, keyResourceId, imageUrl, version }
      if (typeof item.key !== "string" || typeof item.keyResourceId !== "string") continue;
      out.push({
        key: item.key as string,
        mediaType: "image",
        url: typeof item.imageUrl === "string" ? item.imageUrl as string : undefined,
        title: item.key as string,
        persisted: { id: item.keyResourceId as string, version: item.version as number },
      });
    } else if (toolName === "video_workflow__generate_video") {
      // Video tool: { status, key, keyResourceId, videoUrl, version }
      if (typeof item.key !== "string" || typeof item.keyResourceId !== "string") continue;
      out.push({
        key: item.key as string,
        mediaType: "video",
        url: typeof item.videoUrl === "string" ? item.videoUrl as string : undefined,
        title: item.key as string,
        persisted: { id: item.keyResourceId as string, version: item.version as number },
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
 * When provided, enables domain-specific context refresh
 * and skill injection — without forking the core loop.
 */
export interface AgentConfig {
  /** Static context appended to the system prompt once (e.g. domain IDs). */
  staticContext?: string;
  /** Skill names whose full content should be injected into the system prompt. */
  skills?: string[];
  /** LLM model id to use for this run (must be in MODEL_OPTIONS). */
  model?: string;
}

/* ------------------------------------------------------------------ */
/*  Core MCP names — always in scope                                   */
/* ------------------------------------------------------------------ */

const CORE_MCPS = new Set(["mcp_manager", "ui", "sync", "subagent"]);


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

/* ------------------------------------------------------------------ */
/*  Abort-aware promise racing                                         */
/* ------------------------------------------------------------------ */

/**
 * Race a promise against an AbortSignal.
 * When the signal fires before the promise settles, immediately rejects —
 * the underlying promise is abandoned (fire-and-forget).
 * Used to make tool calls cancellable without each tool implementing abort.
 */
function abortRace<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new Error("Task cancelled"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error("Task cancelled"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (val) => { signal.removeEventListener("abort", onAbort); resolve(val); },
      (err) => { signal.removeEventListener("abort", onAbort); reject(err); },
    );
  });
}

export interface AgentResponse {
  sessionId: string;
  reply: string;
  messages: ChatMessage[];
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

export interface UsageEvent {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  model: string;
  maxContextTokens: number;
}

export interface StreamCallbacks {
  onSession?: (sessionId: string) => void;
  onDelta?: (text: string) => void;
  onToolCall?: (call: ToolCall) => void;
  onToolStart?: (event: ToolStartEvent) => void;
  onToolEnd?: (event: ToolEndEvent) => void;
  onUploadRequest?: (req: unknown) => void;
  onKeyResource?: (resource: KeyResourceEvent) => void;
  /** Forwarded from MCP tool's onProgress — used for subagent task progress etc. */
  onProgress?: (event: { type: string; data: unknown }) => void;
  /** LLM usage stats emitted after each completion round. */
  onUsage?: (event: UsageEvent) => void;
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
  await initMcp();

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
  await initMcp();

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

/* ------------------------------------------------------------------ */
/*  Anthropic prefix caching — cache_control breakpoints               */
/* ------------------------------------------------------------------ */

/**
 * Attach `cache_control: { type: "ephemeral" }` to a message.
 * String content is converted to content-block array format so the
 * breakpoint can be placed on the content block.
 * Messages with null content (e.g. assistant with only tool_calls)
 * are returned unchanged.
 */
function withCacheBreakpoint(msg: LlmMessage): LlmMessage {
  const raw = msg as unknown as Record<string, unknown>;
  if (typeof raw.content === "string") {
    return {
      ...raw,
      content: [
        { type: "text", text: raw.content, cache_control: { type: "ephemeral" } },
      ],
    } as unknown as LlmMessage;
  }
  return msg;
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
  const baseSystemPrompt = await buildSystemPrompt(config?.skills);
  const systemPrompt = config?.staticContext
    ? `${baseSystemPrompt}\n\n## Context\n${config.staticContext}`
    : baseSystemPrompt;

  // Resolve images: data URLs → OSS HTTP URLs
  const resolvedImages = images?.length ? await resolveImages(images) : undefined;

  const userMsg: ChatMessage = { role: "user", content: userMessage };
  if (resolvedImages?.length) userMsg.images = resolvedImages;
  const newMessages: ChatMessage[] = [userMsg];
  let persistedCount = 0;

  /** Flush un-persisted messages to DB. */
  async function flush(): Promise<void> {
    const batch = newMessages.slice(persistedCount);
    if (batch.length > 0) {
      await pushMessages(session.id, batch);
    persistedCount = newMessages.length;
  }
}

  while (true) {
    const historyLlm = session.messages.map(chatMsgToLlm);
    const newLlm = newMessages.map(chatMsgToLlm);

    // Anthropic prefix caching breakpoints:
    // BP1: system prompt — semi-static, high hit rate across iterations
    // BP2: last history message — stable boundary before dynamic content
    if (historyLlm.length > 0) {
      historyLlm[historyLlm.length - 1] = withCacheBreakpoint(
        historyLlm[historyLlm.length - 1]!,
      );
    }

    const llmMessages: LlmMessage[] = [
      withCacheBreakpoint({ role: "system", content: systemPrompt } as LlmMessage),
      ...historyLlm,
      ...newLlm,
    ];

    const mcpTools = await registry.listToolsForProviders(CORE_MCPS);
    const openaiTools = mcpTools.map(mcpToolToOpenAI);
    // BP3: last tool — cache tool definitions across iterations (stable: always core MCPs only)
    if (openaiTools.length > 0) {
      Object.assign(openaiTools[openaiTools.length - 1]!, {
        cache_control: { type: "ephemeral" },
      });
    }

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

      const toolMsg: ChatMessage = {
        role: "tool",
        tool_call_id: tc.id,
        content,
      };
      newMessages.push(toolMsg);
    }

    // Flush assistant + tool messages
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
  userName: string | undefined,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  images?: string[],
  config?: AgentConfig,
): Promise<AgentResponse> {
  const toolCtx: ToolContext = {
    sessionId: session.id,
    userName,
    onProgress: callbacks.onProgress
      ? (event) => callbacks.onProgress!(event)
      : undefined,
    signal,
  };
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
  const baseSystemPrompt = await buildSystemPrompt(config?.skills);
  const systemPrompt = config?.staticContext
    ? `${baseSystemPrompt}\n\n## Context\n${config.staticContext}`
    : baseSystemPrompt;

  // Resolve images: data URLs → OSS HTTP URLs
  const resolvedImages = images?.length ? await resolveImages(images) : undefined;

  const userMsg: ChatMessage = { role: "user", content: userMessage };
  if (resolvedImages?.length) userMsg.images = resolvedImages;
  const newMessages: ChatMessage[] = [userMsg];
  let persistedCount = 0;

  /** Flush un-persisted messages to DB. */
  async function flush(): Promise<void> {
    const batch = newMessages.slice(persistedCount);
    if (batch.length > 0) {
      await pushMessages(session.id, batch);
      persistedCount = newMessages.length;
  }
}

  // Resolve & validate model
  const modelId = resolveModel(config?.model);
  if (config?.model && config.model !== modelId) {
    console.warn(`[agent] Rejected non-whitelisted model: ${config.model} → fallback ${modelId}`);
  }

  let lastReply = "";

  while (true) {
    if (signal?.aborted) break;

    const historyLlm = session.messages.map(chatMsgToLlm);
    const newLlm = newMessages.map(chatMsgToLlm);

    // Anthropic prefix caching breakpoints (same as sync loop)
    if (historyLlm.length > 0) {
      historyLlm[historyLlm.length - 1] = withCacheBreakpoint(
        historyLlm[historyLlm.length - 1]!,
      );
    }

    const llmMessages: LlmMessage[] = [
      withCacheBreakpoint({ role: "system", content: systemPrompt } as LlmMessage),
      ...historyLlm,
      ...newLlm,
    ];

    const mcpTools = await registry.listToolsForProviders(CORE_MCPS);
    const openaiTools = mcpTools.map(mcpToolToOpenAI);
    if (openaiTools.length > 0) {
      Object.assign(openaiTools[openaiTools.length - 1]!, {
        cache_control: { type: "ephemeral" },
      });
    }

    let currentContent = "";

    try {
      const MAX_STREAM_RETRIES = 10;
      const BASE_DELAY_MS = 1000;
      const MAX_DELAY_MS = 30_000;
      const toolCallsByIndex = new Map<number, ToolCall>();
      let lastUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined;

      for (let attempt = 0; ; attempt++) {
        const stream = await chatCompletionStream(llmMessages, openaiTools, signal, modelId);
        try {
          for await (const chunk of stream) {
            // Capture usage FIRST — the final chunk has usage but empty choices
            if (chunk.usage) {
              lastUsage = chunk.usage;
            }
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
          break; // stream completed successfully
        } catch (streamErr: unknown) {
          // Abort the stream to prevent dangling connection / unhandled rejections
          stream.controller.abort();
          if (
            !signal?.aborted &&
            isTransientStreamError(streamErr) &&
            attempt < MAX_STREAM_RETRIES
          ) {
            const delay = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
            console.warn(
              `[agent] Stream attempt ${attempt + 1}/${MAX_STREAM_RETRIES} failed (${(streamErr as Error).message}), retrying in ${delay}ms...`,
            );
            await new Promise((r) => setTimeout(r, delay));
            // Reset accumulated content — we'll redo the full LLM call
            currentContent = "";
            toolCallsByIndex.clear();
            lastUsage = undefined;
            continue;
          }
          throw streamErr;
        }
      }

      lastReply = currentContent;

      // Emit usage
const maxCtx = MODEL_OPTIONS.find((m) => m.id === modelId)?.maxContextTokens ?? 1_000_000;
      if (lastUsage) {
        // Extract cache read tokens from prompt_tokens_details (OpenAI SDK format)
        const usageRaw = lastUsage as Record<string, unknown>;
        const details = usageRaw.prompt_tokens_details as Record<string, unknown> | undefined;
        const cacheRead = typeof details?.cached_tokens === "number" ? details.cached_tokens : 0;
        callbacks.onUsage?.({
          promptTokens: lastUsage.prompt_tokens,
          completionTokens: lastUsage.completion_tokens,
          totalTokens: lastUsage.total_tokens,
          cacheReadTokens: cacheRead,
          model: modelId,
          maxContextTokens: maxCtx,
        });

        // Context checkpoint: compress history when approaching limit
        if (lastUsage.prompt_tokens > maxCtx * CHECKPOINT_THRESHOLD) {
          const allCurrent = [...session.messages, ...newMessages];
          const compressed = await compressToCheckpoint(allCurrent);
          if (compressed) {
            // Persist compressed messages to DB
            await replaceMessages(session.id, compressed);
            // Reset in-memory state: compressed becomes new history
            session.messages = compressed;
            newMessages.length = 0;
            persistedCount = 0;
            console.log(
              `[agent] Context checkpoint triggered (${lastUsage.prompt_tokens}/${maxCtx} tokens)`,
            );
          }
        }
      }

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
          const result = await abortRace(
            registry.callTool(tc.function.name, args, toolCtx),
            signal,
          );

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

      // Flush assistant + tool messages
      await flush();
    } catch (err: unknown) {
      if (signal?.aborted) {
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
