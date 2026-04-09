import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma";
import { getById, updatePrompt, updateData, deleteResource } from "@/lib/services/key-resource-service";

type Params = { params: Promise<{ id: string }> };

/** GET /api/key-resources/:id — detail with all versions */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;

  try {
    const detail = await getById(id);
    if (!detail) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

const PromptPatchSchema = z.object({
  prompt: z.string().min(1),
});

const JsonNestedValueSchema: z.ZodType<Prisma.JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonNestedValueSchema),
    z.record(z.string(), JsonNestedValueSchema),
  ]),
);

const JsonValueSchema: z.ZodType<Prisma.InputJsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(JsonNestedValueSchema),
    z.record(z.string(), JsonNestedValueSchema),
  ]),
);

const DataPatchSchema = z.object({
  data: JsonValueSchema,
});

/** PATCH /api/key-resources/:id — update prompt (no regeneration) */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }


  try {
    const promptParsed = PromptPatchSchema.safeParse(raw);
    if (promptParsed.success) {
      const result = await updatePrompt(id, promptParsed.data.prompt);
      return NextResponse.json(result);
    }

    const dataParsed = DataPatchSchema.safeParse(raw);
    if (dataParsed.success) {
      const detail = await getById(id);
      if (!detail) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      if (detail.mediaType !== "json") {
        return NextResponse.json({ error: "Only JSON key resources support data updates" }, { status: 400 });
      }
      const result = await updateData(id, dataParsed.data.data);
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: "PATCH body must include either prompt or data" }, { status: 400 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** DELETE /api/key-resources/:id */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    await deleteResource(id);
    return NextResponse.json({ deleted: id });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
