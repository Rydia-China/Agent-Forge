import { NextRequest } from "next/server";
import { subscribeEvents, getTask } from "@/lib/services/task-service";
import { prisma } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

function toSse(id: number | null, event: string, data: unknown): string {
  const idLine = id != null ? `id: ${id}\n` : "";
  return `${idLine}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
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
  const MAX_INT4 = 2147483647;
  const validLastId =
    lastEventId != null && !isNaN(lastEventId) && lastEventId <= MAX_INT4
      ? lastEventId
      : undefined;

  const encoder = new TextEncoder();
  const ac = new AbortController();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch (err) {
          // Controller closed (client disconnected)
          console.log(`[task:${id}] SSE send failed (client disconnected):`, err);
        }
      };

      // 心跳计时器，每 30 秒发送一次，附带任务状态
      const heartbeatInterval = setInterval(async () => {
        if (ac.signal.aborted) return;
        try {
          const current = await prisma.task.findUnique({
            where: { id },
            select: { status: true, updatedAt: true },
          });
          send(toSse(null, "heartbeat", {
            status: current?.status ?? "unknown",
            elapsedMs: current ? Date.now() - current.updatedAt.getTime() : 0,
          }));
        } catch {
          send(toSse(null, "heartbeat", {}));
        }
      }, 30000);

      try {
        for await (const event of subscribeEvents(id, validLastId, ac.signal)) {
          if (ac.signal.aborted) break;
          send(toSse(event.id, event.type, event.data));
        }
      } catch (err) {
        // Generator threw or was aborted
        console.error(`[task:${id}] SSE stream error:`, err);
        // 尝试发送错误事件给客户端
        try {
          const errorMsg = err instanceof Error ? err.message : String(err);
          send(toSse(null, "error", { error: errorMsg }));
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
