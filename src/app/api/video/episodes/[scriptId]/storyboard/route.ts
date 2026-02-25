import { NextRequest, NextResponse } from "next/server";
import { getStoryboard } from "@/lib/services/video-workflow-service";

/** GET /api/video/episodes/[scriptId]/storyboard — get full storyboard (scenes + shots) */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ scriptId: string }> },
) {
  const { scriptId } = await params;
  try {
    const storyboard = await getStoryboard(scriptId);
    return NextResponse.json(storyboard);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
