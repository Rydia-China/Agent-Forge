import { NextRequest, NextResponse } from "next/server";
import * as svc from "@/lib/services/mcp-service";

type Params = { params: Promise<{ name: string }> };

/** GET /api/mcps/:name — get MCP server details */
export async function GET(_req: NextRequest, { params }: Params) {
  const { name } = await params;
  const mcp = await svc.getMcpServer(name);
  if (!mcp) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(mcp);
}

/** PUT /api/mcps/:name — push a new version (auto-promote + reload by default) */
export async function PUT(req: NextRequest, { params }: Params) {
  const { name } = await params;
  try {
    const body: unknown = await req.json();
    const parsed = svc.McpUpdateParams.omit({ name: true }).parse(body);
    const { record, version, loadError } = await svc.updateMcpServer({ name, ...parsed });
    return NextResponse.json({ record, version, loadError });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

/** DELETE /api/mcps/:name */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { name } = await params;
  try {
    await svc.deleteMcpServer(name);
    return NextResponse.json({ deleted: name });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
