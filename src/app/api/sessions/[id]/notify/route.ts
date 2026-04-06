import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pushNotification } from "@/lib/services/chat-session-service";

const NotifySchema = z.object({
  category: z.string().min(1),
});

/** POST /api/sessions/[id]/notify — push an external change notification */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = NotifySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  await pushNotification(sessionId, parsed.data.category);

  return NextResponse.json({ ok: true });
}
