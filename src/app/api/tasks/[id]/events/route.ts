import { NextRequest } from "next/server";
import { subscribeEvents, getTask } from "@/lib/services/task-service";

type Params = { params: Promise<{ id: string }> };

function toSse(id: number, event: string, data: unknown): string {
  return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** GET /api/tasks/:id/events — SSE stream with reconnection via Last-Event-ID */
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;

  const task = await getTask(id);
  if (!task) {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Parse Last-Event-ID from header (standard SSE reconnection)
  const lastEventIdRaw = req.headers.get("Last-Event-ID")
    ?? req.nextUrl.searchParams.get("last_event_id");
  const lastEventId = lastEventIdRaw ? parseInt(lastEventIdRaw, 10) : undefined;
  const validLastId =
    lastEventId != null && !isNaN(lastEventId) ? lastEventId : undefined;

  const encoder = new TextEncoder();
  const ac = new AbortController();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Controller closed (client disconnected)
        }
      };

      try {
        for await (const event of subscribeEvents(id, validLastId, ac.signal)) {
          if (ac.signal.aborted) break;
          send(toSse(event.id, event.type, event.data));
        }
      } catch {
        // Generator threw or was aborted — close gracefully
      }

      try {
        controller.close();
      } catch {
        /* already closed */
      }
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
