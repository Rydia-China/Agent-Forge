import { NextRequest, NextResponse } from "next/server";
import * as svc from "@/lib/services/api-service";

type Params = { params: Promise<{ name: string }> };

/** PUT /api/apis/:name/production — set production version { version: N } */
export async function PUT(req: NextRequest, { params }: Params) {
  const { name } = await params;
  try {
    const body: unknown = await req.json();
    const { version } = svc.ApiSetProductionParams.omit({ name: true }).parse(body);
    const record = await svc.setApiProduction(name, version);
    return NextResponse.json({
      name: record.name,
      productionVersion: record.productionVersion,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
