import { NextRequest, NextResponse } from "next/server";
import * as svc from "@/lib/services/mcp-service";

type Params = { params: Promise<{ name: string }> };

/** GET /api/mcps/:name/versions — list all versions */
export async function GET(_req: NextRequest, { params }: Params) {
  const { name } = await params;
  try {
    const versions = await svc.listMcpServerVersions(name);
    return NextResponse.json(versions);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 404 });
  }
}
