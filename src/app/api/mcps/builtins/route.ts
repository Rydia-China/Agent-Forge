import { NextResponse } from "next/server";
import { initMcp } from "@/lib/mcp/init";
import * as svc from "@/lib/services/mcp-service";

/** GET /api/mcps/builtins — list catalog MCPs with availability & active status */
export async function GET() {
  await initMcp();
  const providers = svc.listStaticMcpProviders();
  return NextResponse.json(providers);
}
