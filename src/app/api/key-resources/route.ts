import { NextRequest, NextResponse } from "next/server";
import { listByScope, listByScopeAndMediaType } from "@/lib/services/key-resource-service";

/** GET /api/key-resources?scopeType=novel&scopeId=xxx[&mediaType=image] */
export async function GET(req: NextRequest) {
  const scopeType = req.nextUrl.searchParams.get("scopeType");
  const scopeId = req.nextUrl.searchParams.get("scopeId");
  if (!scopeType || !scopeId) {
    return NextResponse.json({ error: "scopeType and scopeId are required" }, { status: 400 });
  }

  const mediaType = req.nextUrl.searchParams.get("mediaType");

  try {
    const rows = mediaType
      ? await listByScopeAndMediaType(scopeType, scopeId, mediaType)
      : await listByScope(scopeType, scopeId);
    return NextResponse.json(rows);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
