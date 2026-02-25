import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  updateKeyResource,
  deleteKeyResource,
} from "@/lib/services/key-resource-service";
import type { Prisma } from "@/generated/prisma";

type Params = { params: Promise<{ id: string }> };

const PatchSchema = z.object({
  data: z.unknown(),
  title: z.string().optional(),
});

/** PATCH /api/key-resources/:id — update data (and optionally title) */
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
    const row = await updateKeyResource(id, {
      data: parsed.data.data as Prisma.InputJsonValue,
      title: parsed.data.title,
    });
    return NextResponse.json(row);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** DELETE /api/key-resources/:id */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    await deleteKeyResource(id);
    return NextResponse.json({ deleted: id });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
