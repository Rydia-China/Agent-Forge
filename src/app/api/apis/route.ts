import { NextRequest, NextResponse } from "next/server";
import * as svc from "@/lib/services/api-service";

/** GET /api/apis — list all APIs */
export async function GET() {
  const apis = await svc.listApis();
  return NextResponse.json(apis);
}

/** POST /api/apis — create a new API */
export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json();
    const params = svc.ApiCreateParams.parse(body);
    const { record, version } = await svc.createApi(params);
    return NextResponse.json({ record, version }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
