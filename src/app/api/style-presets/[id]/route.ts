import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import * as stylePresetService from "@/lib/services/style-preset-service";

type Params = { params: Promise<{ id: string }> };

/** GET /api/style-presets/:id */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const row = await stylePresetService.getById(id);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(row);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

const PatchSchema = z.object({
  name: z.string().min(1).optional(),
  prompt: z.string().min(1).optional(),
  referenceImageUrl: z.string().url().nullable().optional(),
});

/** PATCH /api/style-presets/:id */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  try {
    const updated = await stylePresetService.update(id, parsed.data);
    return NextResponse.json(updated);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** DELETE /api/style-presets/:id */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    await stylePresetService.remove(id);
    return NextResponse.json({ deleted: id });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
