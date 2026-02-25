import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { submitVideoTask } from "@/lib/video/task-service";

const VideoContextSchema = z.object({
  novelId: z.string().min(1),
  novelName: z.string().min(1),
  scriptKey: z.string().min(1),
});

const SubmitSchema = z.object({
  message: z.string().min(1),
  session_id: z.string().optional(),
  user: z.string().optional(),
  images: z.array(z.string()).optional(),
  video_context: VideoContextSchema,
  preload_mcps: z.array(z.string()).optional(),
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

  const { message, session_id, user, images, video_context, preload_mcps, skills } = parsed.data;

  const result = await submitVideoTask({
    message,
    sessionId: session_id,
    user,
    images,
    videoContext: {
      novelId: video_context.novelId,
      novelName: video_context.novelName,
      scriptKey: video_context.scriptKey,
    },
    preloadMcps: preload_mcps,
    skills,
  });

  return NextResponse.json({
    task_id: result.taskId,
    session_id: result.sessionId,
  });
}
