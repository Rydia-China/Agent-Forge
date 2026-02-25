import { NextRequest, NextResponse } from "next/server";
import { getEpisodeContent } from "@/lib/services/video-workflow-service";

/** GET /api/video/episodes/[scriptId]/content — get episode script text */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ scriptId: string }> },
) {
  const { scriptId } = await params;
  try {
    const content = await getEpisodeContent(scriptId);
    return NextResponse.json({ content });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
