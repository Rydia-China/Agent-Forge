import { NextRequest } from "next/server";
import { subscribeEvents, getSubAgent } from "@/lib/services/subagent-service";

type Params = { params: Promise<{ id: string }> };

function toSse(id: number, event: string, data: unknown): string {
  return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;

  const subagent = await getSubAgent(id);
  if (!subagent) {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

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
        } catch (err) {
          console.log(`[subagent:${id}] SSE send failed (client disconnected):`, err);
        }
      };

      const heartbeatInterval = setInterval(() => {
        if (!ac.signal.aborted) {
          send(toSse(Date.now(), "heartbeat", {}));
        }
      }, 30000);

      try {
        for await (const event of subscribeEvents(id, validLastId, ac.signal)) {
          if (ac.signal.aborted) break;
          send(toSse(event.id, event.type, event.data));
        }
      } catch (err) {
        console.error(`[subagent:${id}] SSE stream error:`, err);
        try {
          const errorMsg = err instanceof Error ? err.message : String(err);
          send(toSse(Date.now(), "error", { error: errorMsg }));
        } catch {
          /* best effort */
        }
      } finally {
        clearInterval(heartbeatInterval);
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
