import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { submitSubAgent } from "@/lib/services/subagent-service";
import { NovelContextProvider } from "@/lib/video/novel-context-provider";
import { ensureVideoSchema } from "@/lib/video/schema";
import { resolveModel } from "@/lib/agent/models";

const SubmitSchema = z.object({
  message: z.string().min(1),
  session_id: z.string().optional(),
  user: z.string().optional(),
  images: z.array(z.string()).optional(),
  model: z.string().optional(),
  skills: z.array(z.string()).optional(),
});

/** POST /api/video/novel/[novelId]/chat — submit a novel-level resource subagent */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ novelId: string }> },
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

  const { message, session_id, user, images, model, skills } = parsed.data;
  const result = await submitSubAgent({
    message,
    sessionId: session_id,
    user: user ?? `video:${novelId}`,
    images,
    model: resolveModel(model),
    agentConfig: {
      contextProvider: new NovelContextProvider({ novelId }),
      skills,
    },
    beforeRun: () => ensureVideoSchema(),
  });

  return NextResponse.json({
    subagent_id: result.subagentId,
    task_id: result.subagentId,
    session_id: result.sessionId,
  });
}
