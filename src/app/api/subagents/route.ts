import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { submitSubAgent } from "@/lib/services/subagent-service";
import { resolveModel } from "@/lib/agent/models";

const SubmitSchema = z.object({
  message: z.string().min(1),
  session_id: z.string().optional(),
  user: z.string().optional(),
  images: z.array(z.string()).optional(),
  parent_agent_id: z.string().optional(),
  model: z.string().optional(),
});

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

  const { message, session_id, user, images, parent_agent_id, model } = parsed.data;
  const result = await submitSubAgent({
    message,
    sessionId: session_id,
    user,
    images,
    parentAgentId: parent_agent_id,
    model: resolveModel(model),
  });

  return NextResponse.json({
    subagent_id: result.subagentId,
    session_id: result.sessionId,
  });
}
