import { z } from "zod";
import { registry } from "../registry";

const DEFAULT_BASE_URL = "http://localhost:8001";

const BaseHttpParams = {
  baseUrl: z.string().url().optional(),
};

const McpToolsParams = z.object({
  ...BaseHttpParams,
  provider: z.string().min(1),
  namesOnly: z.boolean().optional(),
  required: z.array(z.string().min(1)).optional(),
  forbidden: z.array(z.string().min(1)).optional(),
});

const McpCallParams = z.object({
  ...BaseHttpParams,
  provider: z.string().min(1),
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).optional(),
  id: z.union([z.string(), z.number()]).optional(),
});

const SubagentGetParams = z.object({
  ...BaseHttpParams,
  subagentId: z.string().min(1),
});
const SessionGetParams = z.object({
  ...BaseHttpParams,
  sessionId: z.string().min(1),
});
const SessionToolsParams = z.object({
  ...BaseHttpParams,
  sessionId: z.string().min(1),
  includeToolResults: z.boolean().optional(),
  includeArguments: z.boolean().optional(),
  resultMaxChars: z.number().int().positive().max(50_000).optional(),
  toolNames: z.array(z.string().min(1)).optional(),
  toolCallIds: z.array(z.string().min(1)).optional(),
  messageIndexes: z.array(z.number().int().nonnegative()).optional(),
});

const SubagentEventsParams = z.object({
  ...BaseHttpParams,
  subagentId: z.string().min(1),
  lastEventId: z.number().int().positive().optional(),
  timeoutMs: z.number().int().positive().max(600_000).optional(),
  raw: z.boolean().optional(),
  showText: z.boolean().optional(),
});

interface SseEvent {
  id?: string;
  event: string;
  rawData: string;
  data: unknown;
}

interface EventSummary {
  total: number;
  byType: Record<string, number>;
  tools: string[];
  lastEventId?: string;
  terminal?: string;
}

interface SessionToolFilters {
  toolNames?: string[];
  toolCallIds?: string[];
  messageIndexes?: number[];
}

function resolveBaseUrl(baseUrl?: string): string {
  return (baseUrl ?? process.env.AGENT_FORGE_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseJsonMaybe(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function parseSseBlock(block: string): SseEvent | null {
  const lines = block.split(/\r?\n/);
  const dataLines: string[] = [];
  let event = "message";
  let id: string | undefined;

  for (const line of lines) {
    if (line.startsWith("id:")) {
      id = line.slice(3).trim();
      continue;
    }
    if (line.startsWith("event:")) {
      event = line.slice(6).trim() || "message";
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) return null;
  const rawData = dataLines.join("\n");
  return { id, event, rawData, data: parseJsonMaybe(rawData) };
}

function splitSseBlocks(input: string): { blocks: string[]; rest: string } {
  const blocks: string[] = [];
  let rest = input;

  while (true) {
    const lfIndex = rest.indexOf("\n\n");
    const crlfIndex = rest.indexOf("\r\n\r\n");
    const candidates = [lfIndex, crlfIndex].filter((idx) => idx >= 0);
    if (candidates.length === 0) break;

    const boundary = Math.min(...candidates);
    const separatorLength = rest.startsWith("\r\n\r\n", boundary) ? 4 : 2;
    blocks.push(rest.slice(0, boundary));
    rest = rest.slice(boundary + separatorLength);
  }

  return { blocks, rest };
}

function parseSseText(text: string): SseEvent[] {
  const { blocks, rest } = splitSseBlocks(text);
  if (rest.trim().length > 0) {
    blocks.push(rest);
  }
  return blocks
    .map(parseSseBlock)
    .filter((event): event is SseEvent => event !== null);
}

async function readHttpPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  const sseEvents = parseSseText(text);
  if (sseEvents.length === 1) {
    return sseEvents[0]!.data;
  }
  if (sseEvents.length > 1) {
    return sseEvents.map((event) => ({
      id: event.id,
      event: event.event,
      data: event.data,
    }));
  }

  return parseJsonMaybe(text);
}

async function callMcp(
  baseUrl: string,
  provider: string,
  method: string,
  params: Record<string, unknown>,
  id: string | number,
): Promise<unknown> {
  const response = await fetch(`${baseUrl}/mcp/${encodeURIComponent(provider)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params,
    }),
  });

  return readHttpPayload(response);
}

function eventDataText(data: unknown): string | undefined {
  if (!isRecord(data)) return undefined;
  return typeof data.text === "string" ? data.text : undefined;
}

function eventToolName(data: unknown): string | undefined {
  if (!isRecord(data)) return undefined;
  if (typeof data.name === "string") return data.name;
  if (typeof data.summary === "string") return data.summary;
  return undefined;
}

function eventError(data: unknown): string | undefined {
  if (!isRecord(data)) return undefined;
  return typeof data.error === "string" ? data.error : undefined;
}
function previewText(value: unknown, maxChars: number): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…`;
}

function parseToolArguments(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return parseJsonMaybe(value);
}

function filterIncludes<T>(filter: T[] | undefined, value: T | undefined): boolean {
  return !filter || (value !== undefined && filter.includes(value));
}

function shouldIncludeSessionToolItem(
  messageIndex: number,
  name: string | undefined,
  toolCallId: string | undefined,
  filters: SessionToolFilters,
): boolean {
  return (
    filterIncludes(filters.messageIndexes, messageIndex) &&
    filterIncludes(filters.toolNames, name) &&
    filterIncludes(filters.toolCallIds, toolCallId)
  );
}

function argumentKeys(args: unknown): string[] | null {
  return isRecord(args) ? Object.keys(args) : null;
}

function taskCount(args: unknown): number | null {
  return isRecord(args) && Array.isArray(args.tasks) ? args.tasks.length : null;
}

function extractMcpToolNames(payload: unknown): string[] {
  if (!isRecord(payload) || !isRecord(payload.result) || !Array.isArray(payload.result.tools)) {
    return [];
  }
  return payload.result.tools
    .map((tool) => isRecord(tool) && typeof tool.name === "string" ? tool.name : null)
    .filter((name): name is string => name !== null);
}

function summarizeMcpTools(
  payload: unknown,
  required: string[],
  forbidden: string[],
): unknown {
  const toolNames = extractMcpToolNames(payload);
  const missingRequired = required.filter((name) => !toolNames.includes(name));
  const forbiddenPresent = forbidden.filter((name) => toolNames.includes(name));
  if (missingRequired.length > 0 || forbiddenPresent.length > 0) {
    throw new Error(JSON.stringify({ missingRequired, forbiddenPresent, toolNames }, null, 2));
  }
  return {
    toolNames,
    required,
    forbidden,
    ok: true,
  };
}

function summarizeSessionTools(
  session: unknown,
  includeToolResults: boolean,
  includeArguments: boolean,
  resultMaxChars: number,
  filters: SessionToolFilters,
): unknown {
  if (!isRecord(session) || !Array.isArray(session.messages)) {
    return { error: "Session payload does not contain messages", session };
  }
  const toolNameById = new Map<string, string>();
  for (const message of session.messages) {
    if (!isRecord(message) || !Array.isArray(message.tool_calls)) continue;
    for (const toolCall of message.tool_calls) {
      if (!isRecord(toolCall)) continue;
      const id = typeof toolCall.id === "string" ? toolCall.id : undefined;
      const fn = isRecord(toolCall.function) ? toolCall.function : {};
      const name = typeof fn.name === "string" ? fn.name : undefined;
      if (id && name) toolNameById.set(id, name);
    }
  }

  const items: unknown[] = [];
  for (let index = 0; index < session.messages.length; index++) {
    const message = session.messages[index];
    if (!isRecord(message)) continue;

    if (Array.isArray(message.tool_calls)) {
      for (const toolCall of message.tool_calls) {
        if (!isRecord(toolCall)) continue;
        const fn = isRecord(toolCall.function) ? toolCall.function : {};
        const id = typeof toolCall.id === "string" ? toolCall.id : undefined;
        const name = typeof fn.name === "string" ? fn.name : undefined;
        if (!shouldIncludeSessionToolItem(index, name, id, filters)) continue;
        const args = parseToolArguments(fn.arguments);
        const item: Record<string, unknown> = {
          messageIndex: index,
          type: "tool_call",
          id: id ?? null,
          name: name ?? null,
          argumentKeys: argumentKeys(args),
          taskCount: taskCount(args),
        };
        if (includeArguments) item.arguments = args;
        items.push(item);
      }
    }

    if (includeToolResults && message.role === "tool") {
      const toolCallId = typeof message.tool_call_id === "string" ? message.tool_call_id : undefined;
      const name = toolCallId ? toolNameById.get(toolCallId) : undefined;
      if (!shouldIncludeSessionToolItem(index, name, toolCallId, filters)) continue;
      items.push({
        messageIndex: index,
        type: "tool_result",
        tool_call_id: toolCallId ?? null,
        name: name ?? null,
        content: previewText(message.content, resultMaxChars),
      });
    }
  }

  return {
    sessionId: typeof session.id === "string" ? session.id : null,
    messageCount: session.messages.length,
    itemCount: items.length,
    filters,
    items,
  };
}

function printCompactEvent(event: SseEvent, showText: boolean): void {
  const tool = eventToolName(event.data);
  const error = eventError(event.data);

  if (event.event === "delta" && !showText) return;
  if (event.event === "heartbeat") return;

  if (event.event === "delta") {
    console.log(`[${event.id ?? "-"}] delta ${JSON.stringify(eventDataText(event.data) ?? "")}`);
    return;
  }

  if (tool) {
    console.log(`[${event.id ?? "-"}] ${event.event} ${tool}`);
    return;
  }

  if (error) {
    console.log(`[${event.id ?? "-"}] ${event.event} ERROR ${error}`);
    return;
  }

  if (event.event === "session" || event.event === "done") {
    console.log(`[${event.id ?? "-"}] ${event.event}`);
    return;
  }

  console.log(`[${event.id ?? "-"}] ${event.event} ${event.rawData}`);
}

function addToSummary(summary: EventSummary, event: SseEvent): void {
  summary.total += 1;
  summary.byType[event.event] = (summary.byType[event.event] ?? 0) + 1;
  summary.lastEventId = event.id ?? summary.lastEventId;

  const tool = eventToolName(event.data);
  if (tool && !summary.tools.includes(tool)) {
    summary.tools.push(tool);
  }

  if (event.event === "done" || event.event === "error") {
    summary.terminal = event.event;
  }
}

async function streamSubagentEvents(params: z.infer<typeof SubagentEventsParams>): Promise<void> {
  const baseUrl = resolveBaseUrl(params.baseUrl);
  const timeoutMs = params.timeoutMs ?? 30_000;
  const raw = params.raw ?? false;
  const showText = params.showText ?? false;
  const url = new URL(`${baseUrl}/api/subagents/${encodeURIComponent(params.subagentId)}/events`);
  if (params.lastEventId != null) {
    url.searchParams.set("last_event_id", String(params.lastEventId));
  }

  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), timeoutMs);
  const decoder = new TextDecoder();
  const summary: EventSummary = { total: 0, byType: {}, tools: [] };
  let buffer = "";

  try {
    const response = await fetch(url, {
      headers: { Accept: "text/event-stream" },
      signal: ac.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }
    if (!response.body) {
      throw new Error("HTTP response body is empty");
    }

    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const split = splitSseBlocks(buffer);
      buffer = split.rest;
      for (const block of split.blocks) {
        const event = parseSseBlock(block);
        if (!event) continue;
        addToSummary(summary, event);
        if (raw) {
          printJson({ id: event.id, event: event.event, data: event.data });
        } else {
          printCompactEvent(event, showText);
        }
      }

      if (summary.terminal) break;
    }
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError")) {
      throw error;
    }
  } finally {
    clearTimeout(timeout);
  }

  const remaining = decoder.decode();
  if (remaining.length > 0) buffer += remaining;
  for (const event of parseSseText(buffer)) {
    addToSummary(summary, event);
    if (raw) {
      printJson({ id: event.id, event: event.event, data: event.data });
    } else {
      printCompactEvent(event, showText);
    }
  }

  printJson({ summary });
}

registry.register({
  name: "debug:mcp-tools",
  description: "List MCP tools through HTTP URL",
  schema: McpToolsParams,
  handler: async (args) => {
    const params = args as z.infer<typeof McpToolsParams>;
    const result = await callMcp(
      resolveBaseUrl(params.baseUrl),
      params.provider,
      "tools/list",
      {},
      1,
    );
    if (params.namesOnly || params.required?.length || params.forbidden?.length) {
      printJson(summarizeMcpTools(result, params.required ?? [], params.forbidden ?? []));
      return;
    }
    printJson(result);
  },
});

registry.register({
  name: "debug:mcp-call",
  description: "Call an MCP tool through HTTP URL",
  schema: McpCallParams,
  handler: async (args) => {
    const params = args as z.infer<typeof McpCallParams>;
    const result = await callMcp(
      resolveBaseUrl(params.baseUrl),
      params.provider,
      "tools/call",
      {
        name: params.name,
        arguments: params.arguments ?? {},
      },
      params.id ?? 1,
    );
    printJson(result);
  },
});

registry.register({
  name: "debug:subagent-get",
  description: "Get subagent status through HTTP URL",
  schema: SubagentGetParams,
  handler: async (args) => {
    const params = args as z.infer<typeof SubagentGetParams>;
    const baseUrl = resolveBaseUrl(params.baseUrl);
    const response = await fetch(
      `${baseUrl}/api/subagents/${encodeURIComponent(params.subagentId)}`,
    );
    printJson(await readHttpPayload(response));
  },
});

registry.register({
  name: "debug:session-tools",
  description: "Summarize session tool calls through HTTP URL",
  schema: SessionToolsParams,
  handler: async (args) => {
    const params = args as z.infer<typeof SessionToolsParams>;
    const baseUrl = resolveBaseUrl(params.baseUrl);
    const response = await fetch(
      `${baseUrl}/api/sessions/${encodeURIComponent(params.sessionId)}`,
    );
    const session = await readHttpPayload(response);
    printJson(summarizeSessionTools(
      session,
      params.includeToolResults ?? false,
      params.includeArguments ?? true,
      params.resultMaxChars ?? 2_000,
      {
        toolNames: params.toolNames,
        toolCallIds: params.toolCallIds,
        messageIndexes: params.messageIndexes,
      },
    ));
  },
});

registry.register({
  name: "debug:subagent-events",
  description: "Watch subagent SSE events through HTTP URL",
  schema: SubagentEventsParams,
  handler: async (args) => {
    await streamSubagentEvents(args as z.infer<typeof SubagentEventsParams>);
  },
});

registry.register({
  name: "debug:session-get",
  description: "Get chat session details through HTTP URL",
  schema: SessionGetParams,
  handler: async (args) => {
    const params = args as z.infer<typeof SessionGetParams>;
    const baseUrl = resolveBaseUrl(params.baseUrl);
    const response = await fetch(
      `${baseUrl}/api/sessions/${encodeURIComponent(params.sessionId)}`,
    );
    printJson(await readHttpPayload(response));
  },
});
