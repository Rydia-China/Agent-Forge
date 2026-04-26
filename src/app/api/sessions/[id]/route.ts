import { NextRequest, NextResponse } from "next/server";
import {
  getSession,
  deleteSession,
  updateSessionTitle,
} from "@/lib/services/chat-session-service";
import { getActiveSubAgentForSession } from "@/lib/services/subagent-service";

type Params = { params: Promise<{ id: string }> };

/** GET /api/sessions/:id — get session with messages + active subagent */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Convert null content to empty string for API response
  const messages = session.messages.map((msg) => ({
    ...msg,
    content: msg.content ?? "",
  }));

  const activeSubAgent = await getActiveSubAgentForSession(id);
  return NextResponse.json({
    ...session,
    messages,
    activeSubAgent: activeSubAgent
      ? { id: activeSubAgent.id, status: activeSubAgent.status }
      : null,
  });
}

/** PATCH /api/sessions/:id — update title */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const body: unknown = await req.json();
    const { title } = body as { title?: string };
    if (!title || typeof title !== "string") {
      return NextResponse.json(
        { error: "Missing 'title' field" },
        { status: 400 },
      );
    }
    await updateSessionTitle(id, title);
    return NextResponse.json({ id, title });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** DELETE /api/sessions/:id */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    await deleteSession(id);
    return NextResponse.json({ deleted: id });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
