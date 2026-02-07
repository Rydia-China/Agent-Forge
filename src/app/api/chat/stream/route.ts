import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runAgentStream } from "@/lib/agent/agent";
import type { ToolCall } from "@/lib/agent/types";

const StreamRequestSchema = z.object({
  message: z.string().min(1),
  session_id: z.string().optional(),
  user: z.string().optional(),
});

function toSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function summarizeTool(call: ToolCall): string {
  if (call.function.name.startsWith("skills__")) {
    try {
      const parsed: unknown = JSON.parse(call.function.arguments);
      if (isRecord(parsed)) {
        const name = parsed.name;
        if (typeof name === "string" && name.trim().length > 0) {
          return `使用了 skill：${name}`;
        }
      }
    } catch {
      /* ignore */
    }
    return "使用了 skill";
  }
  return `调用了工具：${call.function.name}`;
}

export async function POST(req: NextRequest) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = StreamRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const { message, session_id, user } = parsed.data;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(toSse(event, data)));
      };

      runAgentStream(message, session_id, user, {
        onSession: (id) => send("session", { session_id: id }),
        onDelta: (text) => send("delta", { text }),
        onToolCall: (call) => send("tool", { summary: summarizeTool(call) }),
      })
        .then((result) => {
          send("done", { session_id: result.sessionId, reply: result.reply });
          controller.close();
        })
        .catch((err: unknown) => {
          const error = err instanceof Error ? err.message : String(err);
          send("error", { error });
          controller.close();
        });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
