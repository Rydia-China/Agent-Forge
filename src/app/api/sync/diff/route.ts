import { NextRequest, NextResponse } from "next/server";
import { SyncDiffParams, diffWithRemote } from "@/lib/services/sync-service";

/** POST /api/sync/diff — compare local vs remote skills/MCPs */
export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json();
    const params = SyncDiffParams.parse(body);
    const result = await diffWithRemote(params);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
