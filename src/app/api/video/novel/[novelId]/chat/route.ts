import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { submitTask } from "@/lib/services/task-service";
import { ensureVideoSchema } from "@/lib/video/schema";
import { resolveModel } from "@/lib/agent/models";

const SubmitSchema = z.object({
  message: z.string().min(1),
  session_id: z.string().optional(),
  images: z.array(z.string()).optional(),
  model: z.string().optional(),
  skills: z.array(z.string()).optional(),
});

/** POST /api/video/novel/[novelId]/chat — submit a novel-level resource management task */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ novelId: string }> }
) {
  const { novelId } = await params;

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

  const { message, session_id, images, model, skills } = parsed.data;

  // Novel-level session userName: video:{novelId}
  const userName = `video:${novelId}`;

  const result = await submitTask({
    message,
    sessionId: session_id,
    user: userName,
    images,
    model: resolveModel(model),
    agentConfig: {
      staticContext: `novel_id: ${novelId}`,
      skills,
    },
    beforeRun: () => ensureVideoSchema(),
  });

  return NextResponse.json({
    task_id: result.taskId,
    session_id: result.sessionId,
  });
}
