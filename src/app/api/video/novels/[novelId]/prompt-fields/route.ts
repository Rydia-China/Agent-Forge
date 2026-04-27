import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

const PatchBody = z.object({
  target: z.enum(["character", "location", "sub_location"]),
  name: z.string().min(1),
  field: z.string().min(1),
  value: z.string(),
  parentName: z.string().min(1).optional(),
});

/** PATCH /api/video/novels/[novelId]/prompt-fields */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ novelId: string }> },
) {
  const { novelId } = await params;

  let body: z.infer<typeof PatchBody>;
  try {
    const raw: unknown = await req.json();
    body = PatchBody.parse(raw);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Invalid request body";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const novel = await prisma.novel.findUnique({
      where: { id: novelId },
      select: { characterArcs: true, locationBible: true },
    });

    if (!novel) {
      return NextResponse.json({ error: "Novel not found" }, { status: 404 });
    }

    const characterArcs = (novel.characterArcs as Array<Record<string, unknown>>) ?? [];
    const locationBible = (novel.locationBible as Array<Record<string, unknown>>) ?? [];

    if (body.target === "character") {
      const arc = characterArcs.find((a) => String(a.name) === body.name);
      if (!arc) {
        return NextResponse.json({ error: `Character "${body.name}" not found` }, { status: 404 });
      }
      arc[body.field] = body.value;
      await prisma.novel.update({
        where: { id: novelId },
        data: { characterArcs: characterArcs as never },
      });
    } else if (body.target === "location") {
      const loc = locationBible.find((l) => String(l.name) === body.name);
      if (!loc) {
        return NextResponse.json({ error: `Location "${body.name}" not found` }, { status: 404 });
      }
      loc[body.field] = body.value;
      await prisma.novel.update({
        where: { id: novelId },
        data: { locationBible: locationBible as never },
      });
    } else {
      // sub_location
      if (!body.parentName) {
        return NextResponse.json({ error: "parentName required for sub_location" }, { status: 400 });
      }
      const parent = locationBible.find((l) => String(l.name) === body.parentName);
      if (!parent) {
        return NextResponse.json({ error: `Parent location "${body.parentName}" not found` }, { status: 404 });
      }
      const subs = parent.sub_locations as Array<Record<string, unknown>> | undefined;
      if (!subs) {
        return NextResponse.json({ error: `No sub_locations in "${body.parentName}"` }, { status: 404 });
      }
      const sub = subs.find((s) => String(s.name) === body.name);
      if (!sub) {
        return NextResponse.json({ error: `Sub-location "${body.name}" not found in "${body.parentName}"` }, { status: 404 });
      }
      sub[body.field] = body.value;
      await prisma.novel.update({
        where: { id: novelId },
        data: { locationBible: locationBible as never },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Update failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
