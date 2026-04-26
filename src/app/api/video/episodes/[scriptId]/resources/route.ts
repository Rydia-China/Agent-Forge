import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma";
import { listResourcesByScope } from "@/lib/services/key-resource-listing";
import {
  deleteResource,
  getById,
  updateData,
} from "@/lib/services/key-resource-service";

/** GET /api/video/episodes/[scriptId]/resources?novelId=xxx — get episode + novel resources */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ scriptId: string }> },
) {
  const { scriptId } = await params;
  const novelId = req.nextUrl.searchParams.get("novelId");

  if (!novelId) {
    return NextResponse.json({ error: "Missing novelId query parameter" }, { status: 400 });
  }

  try {
    const [novelGroups, scriptGroups] = await Promise.all([
      listResourcesByScope("novel", novelId),
      listResourcesByScope("script", scriptId),
    ]);

    const merged = new Map<string, unknown[]>();
    for (const group of [...novelGroups, ...scriptGroups]) {
      const existing = merged.get(group.category);
      if (existing) {
        existing.push(...group.items);
      } else {
        merged.set(group.category, [...group.items]);
      }
    }

    const categories = [...merged.entries()].map(([category, items]) => ({ category, items }));
    return NextResponse.json({ categories });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

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

const PatchResourceSchema = z.object({
  resourceId: z.string().min(1),
  data: JsonValueSchema,
});

/** PATCH /api/video/episodes/[scriptId]/resources — update a JSON KeyResource's data */
export async function PATCH(req: NextRequest) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = PatchResourceSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  try {
    const resource = await getById(parsed.data.resourceId);
    if (!resource) {
      return NextResponse.json({ error: "Resource not found" }, { status: 404 });
    }
    if (resource.mediaType !== "json") {
      return NextResponse.json({ error: "Only JSON resources support data updates" }, { status: 400 });
    }
    const result = await updateData(parsed.data.resourceId, parsed.data.data);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

const DeleteResourceSchema = z.object({
  resourceId: z.string().min(1),
});

/** DELETE /api/video/episodes/[scriptId]/resources — delete a single KeyResource */
export async function DELETE(req: NextRequest) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = DeleteResourceSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  try {
    await deleteResource(parsed.data.resourceId);
    return NextResponse.json({ deleted: parsed.data.resourceId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
