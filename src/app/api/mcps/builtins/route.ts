import { NextRequest, NextResponse } from "next/server";
import { initMcp } from "@/lib/mcp/init";
import * as svc from "@/lib/services/mcp-service";

/** GET /api/mcps/builtins?session=<id> — list catalog MCPs with session-scoped active status */
export async function GET(req: NextRequest) {
  await initMcp();
  const sessionId = req.nextUrl.searchParams.get("session") ?? undefined;
  const providers = svc.listStaticMcpProviders(sessionId);
  return NextResponse.json(providers);
}
