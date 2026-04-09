import type { TraceToolCall } from "../types.js";

interface SSEEvent {
  id: string;
  event: string;
  data: string;
}

/** Parse raw SSE text chunks into structured events. */
export function parseSSE(chunk: string): SSEEvent[] {
  const events: SSEEvent[] = [];
  const blocks = chunk.split("\n\n").filter(Boolean);
  for (const block of blocks) {
    const lines = block.split("\n");
    let id = "";
    let event = "";
    let data = "";
    for (const line of lines) {
      if (line.startsWith("id: ")) id = line.slice(4);
      else if (line.startsWith("event: ")) event = line.slice(7);
      else if (line.startsWith("data: ")) data = line.slice(6);
    }
    if (event) events.push({ id, event, data });
  }
  return events;
}

export interface CollectedTrace {
  toolCalls: TraceToolCall[];
  reply: string;
  error?: string;
  sessionId?: string;
}

/**
 * Collect a full agent execution trace from an SSE event stream.
 * Returns when "done" or "error" event is received.
 */
export async function collectTrace(
  apiUrl: string,
  taskId: string,
): Promise<CollectedTrace> {
  const url = `${apiUrl}/api/tasks/${taskId}/events`;
  const res = await fetch(url, {
    headers: { Accept: "text/event-stream" },
  });
  if (!res.ok) {
    throw new Error(`SSE connection failed: ${res.status} ${res.statusText}`);
  }
  if (!res.body) throw new Error("No response body");

  const toolCalls: TraceToolCall[] = [];
  const replyParts: string[] = [];
  let error: string | undefined;
  let sessionId: string | undefined;
  let iteration = 0;

  const toolStarts = new Map<string, number>();
  const toolArgs = new Map<string, Record<string, unknown>>();

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const lastDoubleNewline = buffer.lastIndexOf("\n\n");
    if (lastDoubleNewline === -1) continue;

    const complete = buffer.slice(0, lastDoubleNewline + 2);
    buffer = buffer.slice(lastDoubleNewline + 2);

    const events = parseSSE(complete);
    for (const evt of events) {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(evt.data) as Record<string, unknown>;
      } catch {
        continue;
      }

      switch (evt.event) {
        case "session":
          sessionId = data.session_id as string;
          break;
        case "delta":
          replyParts.push(data.text as string);
          break;
        case "tool":
          break;
        case "tool_call_detail":
          toolArgs.set(data.callId as string, (data.args as Record<string, unknown>) ?? {});
          break;
        case "tool_start":
          toolStarts.set(data.callId as string, Date.now());
          iteration = Math.max(iteration, (data.index as number) ?? 0);
          break;
        case "tool_end": {
          const callId = data.callId as string;
          const startTime = toolStarts.get(callId) ?? Date.now();
          const toolError = data.error ? String(data.error) : undefined;
          toolCalls.push({
            callId,
            name: data.name as string,
            args: toolArgs.get(callId) ?? {},
            result: toolError ? `ERROR: ${toolError}` : "ok",
            durationMs: (data.durationMs as number) ?? (Date.now() - startTime),
            iteration,
            error: toolError,
          });
          break;
        }
        case "done":
          return {
            toolCalls,
            reply: (data.reply as string) ?? replyParts.join(""),
            sessionId,
          };
        case "error":
          error = data.error as string;
          return { toolCalls, reply: replyParts.join(""), error, sessionId };
        case "heartbeat":
          break;
      }
    }
  }

  return { toolCalls, reply: replyParts.join(""), error: error ?? "Stream ended unexpectedly", sessionId };
}
