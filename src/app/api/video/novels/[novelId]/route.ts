import { NextRequest, NextResponse } from "next/server";
import { deleteNovel } from "@/lib/services/video-workflow-service";

/** DELETE /api/video/novels/[novelId] — delete a novel and all its episodes */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ novelId: string }> },
) {
  const { novelId } = await params;
  try {
    await deleteNovel(novelId);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
