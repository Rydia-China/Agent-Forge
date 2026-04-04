import { NextRequest, NextResponse } from "next/server";
import { getResourcesByScope } from "@/lib/domain/resource-service";

/** GET /api/video/novel/[novelId]/resources — get novel-level resources */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ novelId: string }> }
) {
  const { novelId } = await params;

  const categories = await getResourcesByScope("novel", novelId);

  return NextResponse.json({ categories });
}
