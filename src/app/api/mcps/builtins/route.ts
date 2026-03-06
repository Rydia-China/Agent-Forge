import { NextRequest, NextResponse } from "next/server";
import { initMcp } from "@/lib/mcp/init";
import * as svc from "@/lib/services/mcp-service";

/** GET /api/mcps/builtins — list all built-in MCP providers with active status */
export async function GET(_req: NextRequest) {
  await initMcp();
  const providers = svc.listStaticMcpProviders();
  return NextResponse.json(providers);
}
