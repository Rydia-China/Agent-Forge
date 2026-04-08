import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import * as svc from "@/lib/services/langfuse-prompt-service";

type Params = { params: Promise<{ name: string }> };

/** GET /api/prompts/:name?version=N — get prompt detail */
export async function GET(req: NextRequest, { params }: Params) {
  const { name } = await params;
  const versionStr = req.nextUrl.searchParams.get("version");
  const version = versionStr ? Number(versionStr) : undefined;
  try {
    const detail = await svc.getPrompt(name, version);
    return NextResponse.json(detail);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes("404") ? 404 : 502;
    return NextResponse.json({ error: msg }, { status });
  }
}

const CreateBody = z.object({
  prompt: z.string().min(1),
  type: z.enum(["text", "chat"]).default("text"),
  labels: z.array(z.string()).optional(),
});

/** POST /api/prompts/:name — create new version */
export async function POST(req: NextRequest, { params }: Params) {
  const { name } = await params;
  try {
    const body: unknown = await req.json();
    const { prompt, type, labels } = CreateBody.parse(body);
    const detail = await svc.createPromptVersion(name, prompt, type, labels);
    return NextResponse.json(detail, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
