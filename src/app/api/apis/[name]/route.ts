import { NextRequest, NextResponse } from "next/server";
import * as svc from "@/lib/services/api-service";

type Params = { params: Promise<{ name: string }> };

/** GET /api/apis/:name — get API details */
export async function GET(_req: NextRequest, { params }: Params) {
  const { name } = await params;
  const api = await svc.getApi(name);
  if (!api) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(api);
}

/** PUT /api/apis/:name — push a new version (auto-promote by default) */
export async function PUT(req: NextRequest, { params }: Params) {
  const { name } = await params;
  try {
    const body: unknown = await req.json();
    const parsed = svc.ApiUpdateParams.omit({ name: true }).parse(body);
    const { record, version } = await svc.updateApi({ name, ...parsed });
    return NextResponse.json({ record, version });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

/** DELETE /api/apis/:name */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { name } = await params;
  try {
    await svc.deleteApi(name);
    return NextResponse.json({ deleted: name });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
