import { NextResponse } from "next/server";
import * as svc from "@/lib/services/langfuse-prompt-service";

/** GET /api/prompts — list all prompts (metadata only) */
export async function GET() {
  try {
    const prompts = await svc.listPrompts();
    return NextResponse.json(prompts);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
