import { NextRequest, NextResponse } from "next/server";
import { runAgent } from "@/lib/agent/agent";
import { writeChatLog } from "@/lib/agent/chat-log";
import { requestContext } from "@/lib/request-context";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const message = body.message ?? body.messages?.[0]?.content;
    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "Missing 'message' field" },
        { status: 400 },
      );
    }

    const logs = body.logs === true;
    const user: string | undefined = body.user;

    const result = await requestContext.run({ userName: user }, () =>
      runAgent(message, body.session_id, user),
    );

    if (logs) {
      await writeChatLog(result.sessionId, result.messages);
    }

    return NextResponse.json({
      session_id: result.sessionId,
      reply: result.reply,
    });
  } catch (err: unknown) {
    console.error("[/api/chat]", err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
