import { NextRequest, NextResponse } from "next/server";
import { listResourcesByScope } from "@/lib/services/key-resource-listing";
import { deleteResource } from "@/lib/services/key-resource-service";
import { prisma } from "@/lib/db";

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
  try {
    const body = (await req.json()) as { resourceId?: string; data?: unknown };
    if (!body.resourceId || body.data === undefined) {
      return NextResponse.json({ error: "Missing resourceId or data" }, { status: 400 });
    }
    await prisma.keyResource.update({
      where: { id: body.resourceId },
      data: { title: typeof body.data === "string" ? body.data : undefined },
    });
    return NextResponse.json({ ok: true });
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
