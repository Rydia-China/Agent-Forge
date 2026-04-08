import { NextRequest, NextResponse } from "next/server";
import { getPromptPreview } from "@/lib/services/video-workflow-service";

/** GET /api/video/novel/[novelId]/prompt-preview?portraitStyle=xxx&sceneStyle=yyy */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ novelId: string }> },
) {
  const { novelId } = await params;
  // undefined = use default, null (via "none") = skip compilation
  const rawPortrait = req.nextUrl.searchParams.get("portraitStyle");
  const rawScene = req.nextUrl.searchParams.get("sceneStyle");
  const portraitStyle = rawPortrait === "none" ? null : (rawPortrait ?? undefined);
  const sceneStyle = rawScene === "none" ? null : (rawScene ?? undefined);

  try {
    const preview = await getPromptPreview(novelId, portraitStyle, sceneStyle);
    return NextResponse.json(preview);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to build prompt preview";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
