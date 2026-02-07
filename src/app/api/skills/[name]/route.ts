import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import matter from "gray-matter";

type Params = { params: Promise<{ name: string }> };

/** GET /api/skills/:name — get skill (JSON or SKILL.md via Accept header) */
export async function GET(req: NextRequest, { params }: Params) {
  const { name } = await params;
  const skill = await prisma.skill.findUnique({ where: { name } });
  if (!skill) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Export as SKILL.md if requested
  const accept = req.headers.get("accept") ?? "";
  if (accept.includes("text/markdown")) {
    const fm: Record<string, unknown> = {
      name: skill.name,
      description: skill.description,
    };
    if (skill.metadata) fm.metadata = skill.metadata;
    const md = matter.stringify(skill.content, fm);
    return new NextResponse(md, {
      headers: { "Content-Type": "text/markdown; charset=utf-8" },
    });
  }

  return NextResponse.json(skill);
}

/** PUT /api/skills/:name — update skill */
export async function PUT(req: NextRequest, { params }: Params) {
  const { name } = await params;
  try {
    const body = await req.json();
    const data: Record<string, unknown> = {};
    if (body.description !== undefined) data.description = body.description;
    if (body.content !== undefined) data.content = body.content;
    if (body.tags !== undefined) data.tags = body.tags;
    if (body.metadata !== undefined) data.metadata = body.metadata;
    const skill = await prisma.skill.update({ where: { name }, data });
    return NextResponse.json(skill);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** DELETE /api/skills/:name */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { name } = await params;
  try {
    await prisma.skill.delete({ where: { name } });
    return NextResponse.json({ deleted: name });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
