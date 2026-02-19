import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runAgentStream } from "@/lib/agent/agent";
import type { KeyResourceEvent } from "@/lib/agent/agent";
import type { ToolCall } from "@/lib/agent/types";
import { requestContext } from "@/lib/request-context";
import { addKeyResource } from "@/lib/services/key-resource-service";
import type { Prisma } from "@/generated/prisma";

const StreamRequestSchema = z.object({
  message: z.string().min(1),
  session_id: z.string().optional(),
  user: z.string().optional(),
  images: z.array(z.string().url()).optional(),
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

  const { message, session_id, user, images } = parsed.data;
  const encoder = new TextEncoder();
  const ac = new AbortController();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(toSse(event, data)));
        } catch {
          // Controller already closed (client disconnected)
        }
      };

      const close = () => {
        try { controller.close(); } catch { /* already closed */ }
      };

      // Track session ID — may be set later by onSession for new sessions
      let resolvedSessionId: string | undefined = session_id;

      requestContext.run({ userName: user }, () =>
        runAgentStream(message, session_id, user, {
          onSession: (id) => {
            resolvedSessionId = id;
            send("session", { session_id: id });
          },
          onDelta: (text) => send("delta", { text }),
          onToolCall: (call) => send("tool", { summary: summarizeTool(call) }),
          onUploadRequest: (req) => send("upload_request", req),
          onKeyResource: (resource: KeyResourceEvent) => {
            const sid = resolvedSessionId;
            if (sid) {
              void addKeyResource(sid, {
                mediaType: resource.mediaType,
                url: resource.url,
                data: resource.data as Prisma.InputJsonValue | undefined,
                title: resource.title,
              }).then((row) => {
                send("key_resource", { ...resource, id: row.id });
              }).catch(() => {
                send("key_resource", resource);
              });
            } else {
              send("key_resource", resource);
            }
          },
        }, ac.signal, images),
      )
        .then((result) => {
          if (!ac.signal.aborted) {
            send("done", { session_id: result.sessionId, reply: result.reply });
          }
          close();
        })
        .catch((err: unknown) => {
          if (!ac.signal.aborted) {
            const error = err instanceof Error ? err.message : String(err);
            send("error", { error });
          }
          close();
        });
    },
    cancel() {
      ac.abort();
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
