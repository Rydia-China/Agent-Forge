import { NextRequest } from "next/server";
import { subscribeNovelFeed } from "@/lib/services/task-service";
import type { NovelFeedEvent } from "@/lib/services/task-service";

type Params = { params: Promise<{ novelId: string }> };

function toSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** GET /api/video/novels/:novelId/task-feed — SSE for novel-level task events */
export async function GET(_req: NextRequest, { params }: Params) {
  const { novelId } = await params;
  const encoder = new TextEncoder();
  const ac = new AbortController();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          /* client disconnected */
        }
      };

      // Heartbeat every 30s
      const heartbeat = setInterval(() => {
        if (!ac.signal.aborted) {
          send(toSse("heartbeat", {}));
        }
      }, 30000);

      try {
        for await (const event of subscribeNovelFeed(novelId, ac.signal)) {
          if (ac.signal.aborted) break;
          send(toSse(event.type, event));
        }
      } catch (err) {
        console.error(`[novel-feed:${novelId}] SSE error:`, err);
      } finally {
        clearInterval(heartbeat);
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
