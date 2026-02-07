import { NextRequest, NextResponse } from "next/server";
import { generateTitle } from "@/lib/agent/llm-client";
import { updateSessionTitle } from "@/lib/services/chat-session-service";

type Params = { params: Promise<{ id: string }> };

/** POST /api/sessions/:id/title — generate & persist session title */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const body: unknown = await req.json();
    const { message } = body as { message?: string };
    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "Missing 'message' field" },
        { status: 400 },
      );
    }

    const title = await generateTitle(message);
    await updateSessionTitle(id, title);
    return NextResponse.json({ id, title });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
