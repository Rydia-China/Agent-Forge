import { NextRequest, NextResponse } from "next/server";
import { SyncPullParams, pullFromRemote } from "@/lib/services/sync-service";

/** POST /api/sync/pull — pull a remote Skill or MCP to local */
export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json();
    const params = SyncPullParams.parse(body);
    const result = await pullFromRemote(params);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
