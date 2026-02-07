import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import matter from "gray-matter";

/** GET /api/skills — list all skills (metadata only) */
export async function GET() {
  const skills = await prisma.skill.findMany({
    select: { name: true, description: true, tags: true, updatedAt: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(skills);
}

/** POST /api/skills — create a skill (JSON or SKILL.md via text/markdown) */
export async function POST(req: NextRequest) {
  try {
    const ct = req.headers.get("content-type") ?? "";

    if (ct.includes("text/markdown")) {
      // Import SKILL.md format
      const raw = await req.text();
      const { data, content } = matter(raw);
      if (!data.name) {
        return NextResponse.json(
          { error: "SKILL.md missing 'name' in frontmatter" },
          { status: 400 },
        );
      }
      const skill = await prisma.skill.upsert({
        where: { name: String(data.name) },
        create: {
          name: String(data.name),
          description: String(data.description ?? ""),
          content: content.trim(),
          metadata: data.metadata ?? undefined,
        },
        update: {
          description: String(data.description ?? ""),
          content: content.trim(),
          metadata: data.metadata ?? undefined,
        },
      });
      return NextResponse.json(skill, { status: 201 });
    }

    // JSON body
    const body = await req.json();
    if (!body.name || !body.content) {
      return NextResponse.json(
        { error: "Missing required fields: name, content" },
        { status: 400 },
      );
    }
    const skill = await prisma.skill.create({
      data: {
        name: body.name,
        description: body.description ?? "",
        content: body.content,
        tags: body.tags ?? [],
        metadata: body.metadata ?? undefined,
      },
    });
    return NextResponse.json(skill, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
