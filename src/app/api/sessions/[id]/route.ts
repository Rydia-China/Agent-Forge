import { NextRequest, NextResponse } from "next/server";
import {
  getSession,
  deleteSession,
  updateSessionTitle,
  type KeyResourceSummary,
} from "@/lib/services/chat-session-service";
import { getActiveTaskForSession } from "@/lib/services/task-service";
import { detectMediaResources } from "@/lib/agent/agent";
import type { ChatMessage } from "@/lib/agent/types";

type Params = { params: Promise<{ id: string }> };

/* ------------------------------------------------------------------ */
/*  Derive media resources from session messages (stateless)            */
/* ------------------------------------------------------------------ */

function deriveMediaFromMessages(messages: ChatMessage[]): KeyResourceSummary[] {
  // Build tool_call_id → tool info map
  const tcMap = new Map<string, string>();
  for (const msg of messages) {
    if (msg.role === "assistant" && msg.tool_calls?.length) {
      for (const tc of msg.tool_calls) {
        tcMap.set(tc.id, tc.function.name);
      }
    }
  }

  const seen = new Set<string>();
  const out: KeyResourceSummary[] = [];

  for (const msg of messages) {
    if (msg.role !== "tool" || !msg.tool_call_id || !msg.content) continue;
    const toolName = tcMap.get(msg.tool_call_id) ?? "unknown";
    for (const kr of detectMediaResources(toolName, msg.content)) {
      if (kr.url && seen.has(kr.url)) continue;
      if (kr.url) seen.add(kr.url);
      out.push({
        id: kr.id,
        mediaType: kr.mediaType,
        url: kr.url ?? null,
        data: null,
        title: kr.title ?? null,
      });
    }
  }
  return out;
}

/** GET /api/sessions/:id — get session with messages + active task */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Derive media from messages + JSON from DB = complete resource set
  const derivedMedia = deriveMediaFromMessages(session.messages);
  const jsonResources = session.keyResources.filter((kr) => kr.mediaType === "json");

  const activeTask = await getActiveTaskForSession(id);
  return NextResponse.json({
    ...session,
    keyResources: [...derivedMedia, ...jsonResources],
    activeTask: activeTask
      ? { id: activeTask.id, status: activeTask.status }
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
