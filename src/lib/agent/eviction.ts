import type { ChatMessage } from "./types";

/* ================================================================== */
/*  Eviction config per tool                                           */
/* ================================================================== */

const DEFAULT_RETENTION = 3;

/** Results shorter than this are kept in context as-is (not worth compressing). */
const SMALL_RESULT_THRESHOLD = 100;

/** Result is a one-line confirmation — evict immediately. */
const EPHEMERAL = new Set([
  // skills
  "skills__create", "skills__update", "skills__delete",
  "skills__import", "skills__set_production",
  // ui
  "ui__request_upload", "ui__present_media", "ui__present_data",
  // biz_db
  "biz_db__execute",
  // mcp_manager
  "mcp_manager__load", "mcp_manager__unload", "mcp_manager__create",
  "mcp_manager__update_code", "mcp_manager__toggle", "mcp_manager__delete",
  "mcp_manager__reload", "mcp_manager__set_production",
  // apis
  "apis__create", "apis__update", "apis__delete",
  "apis__toggle", "apis__set_production",
  // oss
  "oss__delete",
  // langfuse_admin
  "langfuse_admin__create_prompt",
]);

/** High-value results — keep longer but still evictable (and thus recallable). */
const HIGH_RETENTION = new Set([
  "skills__get",
]);
const HIGH_RETENTION_VALUE = 10;

function getBaseRetention(toolName: string): number {
  if (HIGH_RETENTION.has(toolName)) return HIGH_RETENTION_VALUE;
  if (EPHEMERAL.has(toolName)) return 0;
  return DEFAULT_RETENTION;
}

/* ================================================================== */
/*  Summary generation                                                 */
/* ================================================================== */

function tryParseJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const remaining = s.length - max;
  return s.slice(0, max) + `… (+${remaining} chars, use recall for full data)`;
}

function generateSummary(
  toolName: string,
  argsJson: string,
  result: string,
): string {
  const args = asRecord(tryParseJson(argsJson));

  /* --- High-value compression targets --- */

  if (toolName === "subagent__run_text") {
    const model = String(args?.model ?? "unknown");
    return `subagent(${model}): 返回 ${result.length} 字符文本`;
  }

  if (toolName === "biz_db__query") {
    const parsed = asRecord(tryParseJson(result));
    const rows = Array.isArray(parsed?.rows) ? parsed.rows.length : "?";
    const sql = truncate(String(args?.sql ?? ""), 60);
    return `biz_db.query("${sql}"): ${rows} 行`;
  }

  if (toolName === "mcp_manager__get_code") {
    return `mcp_manager.get_code("${args?.name ?? "?"}"): ${result.length} 字符`;
  }

  /* langfuse */
  if (
    toolName === "langfuse__compile_prompt" ||
    toolName === "langfuse_admin__compile_prompt"
  ) {
    return `langfuse.compile("${args?.name ?? "?"}"): ${result.length} 字符`;
  }
  if (
    toolName === "langfuse__get_prompt" ||
    toolName === "langfuse_admin__get_prompt"
  ) {
    return `langfuse.get_prompt("${args?.name ?? "?"}"): 返回模板`;
  }
  if (
    toolName === "langfuse__list_prompts" ||
    toolName === "langfuse_admin__list_prompts"
  ) {
    const parsed = tryParseJson(result);
    const count = Array.isArray(parsed) ? parsed.length : "?";
    return `langfuse.list_prompts: ${count} 个`;
  }

  /* video_mgr — keep URLs in summary */
  if (
    toolName === "video_mgr__generate_image" ||
    toolName === "video_mgr__generate_video"
  ) {
    return `${toolName.split("__")[1]}: ${truncate(result, 150)}`;
  }

  /* oss — keep URLs */
  if (toolName === "oss__upload_from_url" || toolName === "oss__upload_base64") {
    return `oss.upload: ${truncate(result, 150)}`;
  }

  /* Default */
  const shortName = toolName.replace("__", ".");
  return `${shortName}: ${truncate(result, 100)}`;
}

/* ================================================================== */
/*  ToolCallTracker                                                    */
/* ================================================================== */

interface ToolCallRecord {
  toolName: string;
  argsJson: string;
  contentLength: number;
  summary: string;
  position: number;
  retention: number;
}

export class ToolCallTracker {
  private records = new Map<string, ToolCallRecord>();
  private counter = 0;

  /** Register a tool call result. Call for every tool execution. */
  register(
    toolCallId: string,
    toolName: string,
    argsJson: string,
    content: string,
  ): void {
    this.records.set(toolCallId, {
      toolName,
      argsJson,
      contentLength: content.length,
      summary: generateSummary(toolName, argsJson, content),
      position: this.counter++,
      retention: getBaseRetention(toolName),
    });
  }

  /** Whether this tool call's result should be evicted. */
  shouldEvict(toolCallId: string): boolean {
    const rec = this.records.get(toolCallId);
    if (!rec) return false;
    if (rec.contentLength < SMALL_RESULT_THRESHOLD) return false;
    const age = this.counter - rec.position - 1;
    return age >= rec.retention;
  }

  /** Get the compressed summary for an evicted tool call. */
  getSummary(toolCallId: string): string {
    return this.records.get(toolCallId)?.summary ?? "[unknown tool call]";
  }
}

/* ================================================================== */
/*  Scan messages → populate tracker                                   */
/* ================================================================== */

/**
 * Scan history messages and register all tool calls with the tracker.
 * Call once with session.messages before the agent loop.
 */
export function scanMessages(
  messages: readonly ChatMessage[],
  tracker: ToolCallTracker,
): void {
  // Map tool_call_id → { toolName, argsJson }
  const info = new Map<string, { toolName: string; argsJson: string }>();
  for (const msg of messages) {
    if (msg.role === "assistant" && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        info.set(tc.id, {
          toolName: tc.function.name,
          argsJson: tc.function.arguments,
        });
      }
    }
  }
  // Register tool results in order
  for (const msg of messages) {
    if (msg.role === "tool" && msg.tool_call_id) {
      const tc = info.get(msg.tool_call_id);
      if (tc) {
        tracker.register(
          msg.tool_call_id,
          tc.toolName,
          tc.argsJson,
          msg.content ?? "",
        );
      }
    }
  }
}

/* ================================================================== */
/*  Compress messages                                                  */
/* ================================================================== */

/**
 * Compress messages by evicting old tool call results.
 * - Fully evicted assistant+tool groups → collapsed into single assistant summary.
 * - Partially evicted tool results → content replaced with summary.
 * Returns new ChatMessage[] (does NOT mutate input).
 */
export function compressMessages(
  messages: readonly ChatMessage[],
  tracker: ToolCallTracker,
): ChatMessage[] {
  // Find the tail tool-call group: the last assistant(tool_calls)+tool sequence
  // that has NO subsequent assistant text response. These are "pending" — the LLM
  // hasn't processed them yet, so they must NEVER be evicted/collapsed.
  const tailProtected = buildTailProtectedSet(messages);

  const result: ChatMessage[] = [];
  const evictedToolCallIds = new Set<string>();
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i]!;

    /* --- User messages & assistant text (no tool_calls): NEVER compress --- */
    if (msg.role === "user" || (msg.role === "assistant" && !msg.tool_calls?.length)) {
      result.push(msg);
      i++;
      continue;
    }

    /* --- Assistant with tool_calls: check for full eviction --- */
    if (msg.role === "assistant" && msg.tool_calls?.length) {
      // Never evict the tail group
      const isTail = msg.tool_calls.some((tc) => tailProtected.has(tc.id));
      const allEvicted =
        !isTail &&
        msg.tool_calls.every((tc) => tracker.shouldEvict(tc.id));

      if (allEvicted) {
        // Collapse: assistant + all tool results → single summary message
        const summaries = msg.tool_calls.map(
          (tc) => `${tracker.getSummary(tc.id)} (recall:${tc.id})`,
        );
        let content = "[memory] " + summaries.join(" | ");
        if (msg.content) content = msg.content + "\n" + content;

        result.push({ role: "assistant", content });

        // Skip corresponding tool result messages
        const ids = new Set(msg.tool_calls.map((tc) => tc.id));
        i++;
        while (
          i < messages.length &&
          messages[i]!.role === "tool" &&
          messages[i]!.tool_call_id &&
          ids.has(messages[i]!.tool_call_id!)
        ) {
          i++;
        }
        continue;
      }

      // Partial eviction — remove evicted tool calls from assistant,
      // merge their summaries into assistant content as [memory] lines,
      // and skip their tool result messages entirely.
      const isEvicted = (tc: { id: string }) =>
        !tailProtected.has(tc.id) && tracker.shouldEvict(tc.id);
      const keptTcs = msg.tool_calls.filter((tc) => !isEvicted(tc));
      const evictedTcs = msg.tool_calls.filter((tc) => isEvicted(tc));

      if (evictedTcs.length > 0) {
        const memoryLines = evictedTcs.map(
          (tc) => `${tracker.getSummary(tc.id)} (recall:${tc.id})`,
        );
        const memory = "[memory] " + memoryLines.join(" | ");
        let content = msg.content ?? "";
        if (content) content += "\n";
        content += memory;

        // Track evicted IDs so we skip their tool result messages below
        for (const tc of evictedTcs) evictedToolCallIds.add(tc.id);

        result.push({
          role: "assistant",
          content,
          ...(keptTcs.length > 0 ? { tool_calls: keptTcs } : {}),
        });
      } else {
        result.push(msg);
      }
      i++;
      continue;
    }

    /* --- Tool result whose call was evicted (partial) — skip entirely --- */
    if (
      msg.role === "tool" &&
      msg.tool_call_id &&
      evictedToolCallIds.has(msg.tool_call_id)
    ) {
      i++;
      continue;
    }

    /* --- Everything else — pass through --- */
    result.push(msg);
    i++;
  }

  return result;
}

/* ================================================================== */
/*  Tail-group detection                                               */
/* ================================================================== */

/**
 * Find tool_call IDs in the last assistant(tool_calls)+tool group
 * that has no subsequent assistant text response.
 * These are "pending" results the LLM must see — never evict them.
 */
function buildTailProtectedSet(
  messages: readonly ChatMessage[],
): Set<string> {
  const protected_ = new Set<string>();

  // Walk backwards to find the last assistant with tool_calls
  for (let j = messages.length - 1; j >= 0; j--) {
    const m = messages[j]!;
    // If we hit an assistant text response (no tool_calls), the tail is consumed
    if (m.role === "assistant" && !m.tool_calls?.length) break;
    // If we hit a user message, the tail is consumed
    if (m.role === "user") break;
    // Collect tool_call IDs from the tail assistant
    if (m.role === "assistant" && m.tool_calls?.length) {
      for (const tc of m.tool_calls) protected_.add(tc.id);
      break; // only protect the very last group
    }
  }

  return protected_;
}

