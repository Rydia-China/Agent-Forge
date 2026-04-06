import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { submitTask } from "@/lib/services/task-service";
import { ensureVideoSchema } from "@/lib/video/schema";
import { resolveModel } from "@/lib/agent/models";

const VideoContextSchema = z.object({
  novelId: z.string().min(1),
  scriptId: z.string().min(1),
  scriptKey: z.string().min(1),
});

const SubmitSchema = z.object({
  message: z.string().min(1),
  session_id: z.string().optional(),
  user: z.string().optional(),
  images: z.array(z.string()).optional(),
  model: z.string().optional(),
  video_context: VideoContextSchema,
  skills: z.array(z.string()).optional(),
});

/** POST /api/video/tasks — submit a video workflow agent task */
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

  const { message, session_id, user, images, model, video_context, skills } = parsed.data;

  const staticContext = [
    `novel_id: ${video_context.novelId}`,
    `script_id: ${video_context.scriptId}`,
    `script_key: ${video_context.scriptKey}`,
  ].join("\n");

  const result = await submitTask({
    message,
    sessionId: session_id,
    user,
    images,
    model: resolveModel(model),
    agentConfig: {
      staticContext,
      skills,
    },
    beforeRun: () => ensureVideoSchema(),
  });

  return NextResponse.json({
    task_id: result.taskId,
    session_id: result.sessionId,
  });
}
