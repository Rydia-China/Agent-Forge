/**
 * Video Agent Runner — independent agent loop with dynamic context injection.
 *
 * This module provides a standalone tool-use loop that refreshes the
 * ContextProvider on every LLM iteration. It reuses all existing primitives
 * (LLM client, MCP registry, session service, eviction) but has its own
 * while-loop. The original agent.ts is completely untouched.
 *
 * Key differences from the core agent loop:
 * 1. System prompt is rebuilt EVERY iteration (context refresh)
 * 2. MCPs can be pre-loaded before the loop starts
 * 3. Skill content can be injected into the system prompt directly
 */

import type { ContextProvider } from "@/lib/agent/context-provider";
import { type AgentResponse, type StreamCallbacks, detectMediaResources } from "@/lib/agent/agent";
import type { ChatMessage, ToolCall } from "@/lib/agent/types";
import {
  chatCompletionStream,
  mcpToolToOpenAI,
  type LlmMessage,
} from "@/lib/agent/llm-client";
import {
  getOrCreateSession,
  pushMessages,
  stripDanglingToolCalls,
} from "@/lib/services/chat-session-service";
import { buildSystemPrompt } from "@/lib/agent/system-prompt";
import { ToolCallTracker, scanMessages, compressMessages } from "@/lib/agent/eviction";
import { registry } from "@/lib/mcp/registry";
import { initMcp } from "@/lib/mcp/init";
import { isCatalogEntry, loadFromCatalog } from "@/lib/mcp/catalog";
import { sandboxManager } from "@/lib/mcp/sandbox";
import * as mcpService from "@/lib/services/mcp-service";
import { requestContext } from "@/lib/request-context";
import { uploadDataUrl } from "@/lib/services/oss-service";
import { getSkill } from "@/lib/services/skill-service";
import { ensureVideoSchema } from "./schema";
import crypto from "node:crypto";

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

export interface VideoAgentConfig {
  /** MCPs to pre-load before the loop starts. */
  preloadMcps?: string[];
  /** Skill names whose full content should be injected into the system prompt. */
  skills?: string[];
  /** Dynamic context provider — called every iteration. */
  contextProvider: ContextProvider;
}

/* ------------------------------------------------------------------ */
/*  Session lock (same pattern as agent.ts)                            */
/* ------------------------------------------------------------------ */

const sessionLocks = new Map<string, Promise<unknown>>();

function withSessionLock<T>(sid: string, fn: () => Promise<T>): Promise<T> {
  const prev = sessionLocks.get(sid) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  sessionLocks.set(sid, next);
  void next.finally(() => {
    if (sessionLocks.get(sid) === next) sessionLocks.delete(sid);
  });
  return next;
}

/* ------------------------------------------------------------------ */
/*  ChatMessage → LlmMessage (replicated from agent.ts, private fn)    */
/* ------------------------------------------------------------------ */

function chatMsgToLlm(msg: ChatMessage): LlmMessage {
  if (msg.images?.length) {
    const userText = msg.content ?? "";
    const imageMap = msg.images
      .map((url, i) => `- image_${i + 1}: ${url}`)
      .join("\n");
    const annotation =
      `[${msg.images.length} 张图片已附加，需要在 tool call 中引用图片时请使用以下 URL]\n${imageMap}`;
    const fullText = userText ? `${userText}\n\n${annotation}` : annotation;
    return {
      role: "user" as const,
      content: [
        { type: "text" as const, text: fullText },
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/* ------------------------------------------------------------------ */
/*  ToolCall delta assembly (replicated from agent.ts)                 */
/* ------------------------------------------------------------------ */

interface ToolCallDelta {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
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

/* ------------------------------------------------------------------ */
/*  Image resolution                                                   */
/* ------------------------------------------------------------------ */

async function resolveImages(images: string[]): Promise<string[]> {
  return Promise.all(
    images.map(async (img) => {
      if (!img.startsWith("data:")) return img;
      try {
        return await uploadDataUrl(img, "chat-images");
      } catch (err) {
        console.warn("[video-agent] Failed to upload image to OSS:", err);
        return img;
      }
    }),
  );
}

/* ------------------------------------------------------------------ */
/*  Build skill-enriched system prompt                                 */
/* ------------------------------------------------------------------ */

async function buildVideoSystemPrompt(
  config: VideoAgentConfig,
): Promise<string> {
  // Start with the standard system prompt
  const base = await buildSystemPrompt();

  // Inject full skill content for specified skills
  if (!config.skills?.length) return base;

  const skillParts: string[] = [];
  for (const skillName of config.skills) {
    const skill = await getSkill(skillName);
    if (skill) {
      skillParts.push(`### Skill: ${skill.name}\n${skill.content}`);
    }
  }

  if (skillParts.length === 0) return base;
  return base + "\n\n## Pre-loaded Skills (full content — no need to call skills__get)\n\n" + skillParts.join("\n\n---\n\n");
}

/* ------------------------------------------------------------------ */
/*  Pre-load MCPs                                                      */
/* ------------------------------------------------------------------ */

async function preloadMcps(names: string[]): Promise<void> {
  for (const name of names) {
    try {
      if (registry.getProvider(name)) continue; // already loaded
      if (isCatalogEntry(name)) {
        loadFromCatalog(name);
      } else {
        // Dynamic MCP — load from DB via sandbox
        const code = await mcpService.getMcpCode(name);
        if (!code) {
          console.warn(`[video-agent] MCP "${name}" has no production code, skipping`);
          continue;
        }
        const provider = await sandboxManager.load(name, code);
        registry.replace(provider);
      }
    } catch (err) {
      console.warn(`[video-agent] Failed to preload MCP "${name}":`, err);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export async function runVideoAgentStream(
  userMessage: string,
  sessionId: string | undefined,
  userName: string | undefined,
  config: VideoAgentConfig,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  images?: string[],
): Promise<AgentResponse> {
  await initMcp();
  await ensureVideoSchema();

  // Pre-load MCPs
  if (config.preloadMcps?.length) {
    await preloadMcps(config.preloadMcps);
  }

  const session = await getOrCreateSession(sessionId, userName);
  callbacks.onSession?.(session.id);

  return withSessionLock(session.id, () =>
    requestContext.run(
      { userName, sessionId: session.id },
      () => runLoop(userMessage, session, config, callbacks, signal, images),
    ),
  );
}

/* ------------------------------------------------------------------ */
/*  Core loop (with per-iteration context refresh)                     */
/* ------------------------------------------------------------------ */

async function runLoop(
  userMessage: string,
  session: { id: string; messages: ChatMessage[] },
  config: VideoAgentConfig,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  images?: string[],
): Promise<AgentResponse> {
  // Build base system prompt once (skills are static within a run)
  const baseSystemPrompt = await buildVideoSystemPrompt(config);

  const tracker = new ToolCallTracker();
  scanMessages(session.messages, tracker);

  const resolvedImages = images?.length ? await resolveImages(images) : undefined;

  const userMsg: ChatMessage = { role: "user", content: userMessage };
  if (resolvedImages?.length) userMsg.images = resolvedImages;
  const newMessages: ChatMessage[] = [userMsg];
  let persistedCount = 0;

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

    // ═══════════════════════════════════════════════════════
    // KEY DIFFERENCE: refresh context EVERY iteration
    // ═══════════════════════════════════════════════════════
    const dynamicContext = await config.contextProvider.build();

    // Context provider already injects pinned JSON (card_raw, storyboard_raw) at the top
    const systemPrompt = dynamicContext + "\n\n---\n\n" + baseSystemPrompt;

    // Build compressed LLM context
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

      // No tool calls → final response
      if (toolCalls.length === 0) {
        await flush();
        return {
          sessionId: session.id,
          reply: currentContent,
          messages: [...session.messages, ...newMessages],
        };
      }

      // Execute tool calls
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
        } catch { /* invalid JSON */ }

        const t0 = Date.now();
        let toolError: string | undefined;
        try {
          const result = await registry.callTool(tc.function.name, args);

          // Side-channel: upload request
          const uploadReq = (result as Record<string, unknown>)._uploadRequest;
          if (uploadReq) callbacks.onUploadRequest?.(uploadReq);

          const content =
            result.content
              ?.map((c: Record<string, unknown>) =>
                "text" in c ? String(c.text) : JSON.stringify(c),
              )
              .join("\n") ?? "";

          tracker.register(tc.id, tc.function.name, tc.function.arguments, content);

          // Auto-detect media resources from tool output
          const mediaKrs = detectMediaResources(tc.function.name, content);
          for (const kr of mediaKrs) {
            callbacks.onKeyResource?.(kr);
          }

          newMessages.push({ role: "tool", tool_call_id: tc.id, content });
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

      if (signal?.aborted) {
        stripDanglingToolCalls(newMessages);
        await flush();
        break;
      }

      await flush();
    } catch (err: unknown) {
      if (signal?.aborted) {
        stripDanglingToolCalls(newMessages);
        if (
          currentContent &&
          !newMessages.some(
            (m) => m.role === "assistant" && m.content === currentContent,
          )
        ) {
          lastReply = currentContent;
          newMessages.push({ role: "assistant", content: currentContent });
        }
        break;
      }
      throw err;
    }
  }

  // Abort path
  stripDanglingToolCalls(newMessages);
  await flush();
  return {
    sessionId: session.id,
    reply: lastReply,
    messages: [...session.messages, ...newMessages],
  };
}
