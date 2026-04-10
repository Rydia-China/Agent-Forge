import { NextRequest, NextResponse } from "next/server";
import { deleteVersion } from "@/lib/services/key-resource-service";

type Params = { params: Promise<{ id: string; version: string }> };

/** DELETE /api/key-resources/:id/versions/:version */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id, version: versionStr } = await params;

  const version = Number(versionStr);
  if (!Number.isInteger(version) || version < 1) {
    return NextResponse.json({ error: "Invalid version number" }, { status: 400 });
  }

  try {
    const result = await deleteVersion(id, version);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes("not found") || msg.includes("Not found") ? 404
      : msg.includes("last remaining") ? 409
      : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
