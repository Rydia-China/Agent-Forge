import { NextRequest, NextResponse } from "next/server";
import { getEpisodeOutput } from "@/lib/services/video-workflow-service";

/** GET /api/video/episodes/[scriptId]/output — get full episode output JSON (init_result) */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ scriptId: string }> },
) {
  const { scriptId } = await params;
  try {
    const output = await getEpisodeOutput(scriptId);
    if (!output) {
      return NextResponse.json({ error: "No output found" }, { status: 404 });
    }
    return NextResponse.json(output);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
