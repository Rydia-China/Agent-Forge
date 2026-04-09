import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma";
import { listResourcesByScope } from "@/lib/services/key-resource-listing";
import { deleteResource, getById, updateData } from "@/lib/services/key-resource-service";

/** GET /api/video/episodes/[scriptId]/resources?novelId=xxx — get episode + novel resources from KeyResource */
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
    // Merge novel-level + script-level resources
    const [novelGroups, scriptGroups] = await Promise.all([
      listResourcesByScope("novel", novelId),
      listResourcesByScope("script", scriptId),
    ]);

    const merged = new Map<string, unknown[]>();
    for (const g of [...novelGroups, ...scriptGroups]) {
      const existing = merged.get(g.category);
      if (existing) existing.push(...g.items);
      else merged.set(g.category, [...g.items]);
    }

    const categories = [...merged.entries()].map(([category, items]) => ({ category, items }));
    return NextResponse.json({ categories });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** PATCH /api/video/episodes/[scriptId]/resources — update a domain resource's data */
export async function PATCH(req: NextRequest) {
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
  const BodySchema = z.object({
    resourceId: z.string().min(1),
    data: JsonValueSchema,
  });
  try {
    const raw: unknown = await req.json();
    const body = BodySchema.parse(raw);
    const resource = await getById(body.resourceId);
    if (!resource) {
      return NextResponse.json({ error: "Resource not found" }, { status: 404 });
    }
    if (resource.mediaType !== "json") {
      return NextResponse.json({ error: "Only JSON resources support data updates" }, { status: 400 });
    }
    const result = await updateData(body.resourceId, body.data);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** DELETE /api/video/episodes/[scriptId]/resources — delete a single domain resource */
export async function DELETE(req: NextRequest) {
  try {
    const body = (await req.json()) as { resourceId?: string };
    if (!body.resourceId) {
      return NextResponse.json({ error: "Missing resourceId" }, { status: 400 });
    }
    await deleteResource(body.resourceId);
    return NextResponse.json({ deleted: body.resourceId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
