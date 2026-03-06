import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rollback, getById } from "@/lib/services/key-resource-service";

type Params = { params: Promise<{ id: string }> };

const BodySchema = z.object({
  version: z.number().int().min(1),
});

/** POST /api/key-resources/:id/rollback */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  try {
    const before = await getById(id);
    if (!before) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const result = await rollback(id, parsed.data.version);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
