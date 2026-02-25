import { NextRequest, NextResponse } from "next/server";
import { getEpisodeStatus } from "@/lib/services/video-workflow-service";

/** GET /api/video/episodes/[scriptId]/status — get episode workflow status */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ scriptId: string }> },
) {
  const { scriptId } = await params;
  try {
    const status = await getEpisodeStatus(scriptId);
    return NextResponse.json({ status });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
