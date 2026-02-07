import { NextRequest, NextResponse } from "next/server";
import * as svc from "@/lib/services/mcp-service";

type Params = { params: Promise<{ name: string }> };

/** PUT /api/mcps/:name/production — set production version { version: N } (auto reload sandbox) */
export async function PUT(req: NextRequest, { params }: Params) {
  const { name } = await params;
  try {
    const body: unknown = await req.json();
    const { version } = svc.McpSetProductionParams.omit({ name: true }).parse(body);
    const { record, loadError } = await svc.setMcpProduction(name, version);
    return NextResponse.json({
      name: record.name,
      productionVersion: record.productionVersion,
      loadError,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
