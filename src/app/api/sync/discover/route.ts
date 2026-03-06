import { NextRequest, NextResponse } from "next/server";
import { SyncDiscoverParams, discoverRemote } from "@/lib/services/sync-service";

/** POST /api/sync/discover — list skills/MCPs available on a remote hub */
export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json();
    const params = SyncDiscoverParams.parse(body);
    const result = await discoverRemote(params);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
