import { NextRequest, NextResponse } from "next/server";
import { getResources } from "@/lib/services/video-workflow-service";

/** GET /api/video/episodes/[scriptId]/resources?novelId=xxx — get episode resources */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ scriptId: string }> },
) {
  const { scriptId } = await params;
  const novelId = req.nextUrl.searchParams.get("novelId");

  if (!novelId) {
    return NextResponse.json({ error: "Missing novelId query parameter" }, { status: 400 });
  }

  try {
    const resources = await getResources(scriptId, novelId);
    return NextResponse.json(resources);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
