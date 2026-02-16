import { NextRequest, NextResponse } from "next/server";
import * as svc from "@/lib/services/api-service";

type Params = { params: Promise<{ name: string }> };

/** GET /api/public/:name — auto-generated API documentation */
export async function GET(_req: NextRequest, { params }: Params) {
  const { name } = await params;
  const detail = await svc.getApi(name);
  if (!detail) {
    return NextResponse.json({ error: `API "${name}" not found` }, { status: 404 });
  }
  if (!detail.enabled) {
    return NextResponse.json({ error: `API "${name}" is disabled` }, { status: 403 });
  }

  return NextResponse.json({
    name: detail.name,
    description: detail.description,
    version: detail.version,
    schema: detail.schema,
    operations: detail.operations.map((op) => ({
      name: op.name,
      description: op.description,
      type: op.type,
      endpoint: `POST /api/public/${detail.name}/${op.name}`,
      input: op.input,
    })),
  });
}
