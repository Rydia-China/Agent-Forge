import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import * as svc from "@/lib/services/langfuse-prompt-service";

type Params = { params: Promise<{ name: string }> };

const CompileBody = z.object({
  variables: z.record(z.string(), z.string()),
  version: z.number().int().positive().optional(),
});

/** POST /api/prompts/:name/compile — compile prompt with variable substitution */
export async function POST(req: NextRequest, { params }: Params) {
  const { name } = await params;
  try {
    const body: unknown = await req.json();
    const { variables, version } = CompileBody.parse(body);
    const result = await svc.compilePrompt(name, variables, version);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
