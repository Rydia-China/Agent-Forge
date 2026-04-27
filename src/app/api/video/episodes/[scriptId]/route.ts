import { NextRequest, NextResponse } from "next/server";
import { deleteEpisode } from "@/lib/services/episode-service";

/** DELETE /api/video/episodes/[scriptId] — delete an episode and all related data */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ scriptId: string }> },
) {
  const { scriptId } = await params;
  try {
    await deleteEpisode(scriptId);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
