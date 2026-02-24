import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { submitTask } from "@/lib/services/task-service";

const SubmitSchema = z.object({
  message: z.string().min(1),
  session_id: z.string().optional(),
  user: z.string().optional(),
  images: z.array(z.string()).optional(),
});

/** POST /api/tasks — submit a new agent task (returns immediately) */
export async function POST(req: NextRequest) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = SubmitSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const { message, session_id, user, images } = parsed.data;
  const result = await submitTask({
    message,
    sessionId: session_id,
    user,
    images,
  });

  return NextResponse.json({
    task_id: result.taskId,
    session_id: result.sessionId,
  });
}
