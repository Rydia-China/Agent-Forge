import { NextResponse } from "next/server";
import { initMcp } from "@/lib/mcp/init";
import * as svc from "@/lib/services/mcp-service";

/** GET /api/mcps/builtins — list static (built-in) MCP providers */
export async function GET() {
  await initMcp();
  const providers = await svc.listStaticMcpProviders();
  return NextResponse.json(providers);
}
