import { NextRequest, NextResponse } from "next/server";
import { listResourcesByScope } from "@/lib/services/key-resource-listing";

/** GET /api/video/novel/[novelId]/resources — get novel-level resources from KeyResource */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ novelId: string }> },
) {
  const { novelId } = await params;

  try {
    const categories = await listResourcesByScope("novel", novelId);
    return NextResponse.json({ categories });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
