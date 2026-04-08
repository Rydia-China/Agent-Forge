import { NextRequest, NextResponse } from "next/server";
import * as svc from "@/lib/services/langfuse-prompt-service";

type Params = { params: Promise<{ name: string }> };

/** GET /api/prompts/:name/versions — list all versions with full content */
export async function GET(_req: NextRequest, { params }: Params) {
  const { name } = await params;
  try {
    const versions = await svc.getPromptVersions(name);
    return NextResponse.json(versions);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes("not found") ? 404 : 502;
    return NextResponse.json({ error: msg }, { status });
  }
}
