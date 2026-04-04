import { NextRequest, NextResponse } from "next/server";
import { NovelScriptUploadSchema } from "@/lib/video/script-upload-schema";
import { replaceNovelScript } from "@/lib/services/video-workflow-service";

/**
 * POST /api/video/novels/[novelId]/upload-script
 *
 * Re-upload: replaces all episodes for an existing novel.
 * Validates JSON with Zod (fields can be more but not fewer).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ novelId: string }> },
) {
  const { novelId } = await params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const parsed = NovelScriptUploadSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.message },
      { status: 400 },
    );
  }

  try {
    const episodes = await replaceNovelScript(novelId, parsed.data);
    return NextResponse.json(
      { count: episodes.length, episodes },
      { status: 200 },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
