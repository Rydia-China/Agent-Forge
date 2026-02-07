import { NextRequest, NextResponse } from "next/server";
import * as svc from "@/lib/services/mcp-service";

/** GET /api/mcps — list all MCP servers */
export async function GET() {
  const mcps = await svc.listMcpServers();
  return NextResponse.json(mcps);
}

/** POST /api/mcps — create a dynamic MCP server */
export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json();
    const params = svc.McpCreateParams.parse(body);
    const { record, loadError } = await svc.createMcpServer(params);
    return NextResponse.json({ ...record, loadError }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
