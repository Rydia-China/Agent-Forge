import { NextRequest, NextResponse } from "next/server";
import * as svc from "@/lib/services/skill-service";

type Params = { params: Promise<{ name: string }> };

/** GET /api/skills/:name — get skill (JSON or SKILL.md via Accept header) */
export async function GET(req: NextRequest, { params }: Params) {
  const { name } = await params;
  const skill = await svc.getSkill(name);
  if (!skill) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const accept = req.headers.get("accept") ?? "";
  if (accept.includes("text/markdown")) {
    const md = svc.toSkillMd(skill);
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
    const body: unknown = await req.json();
    const parsed = svc.SkillUpdateParams.omit({ name: true }).parse(body);
    const skill = await svc.updateSkill({ name, ...parsed });
    return NextResponse.json(skill);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

/** DELETE /api/skills/:name */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { name } = await params;
  try {
    await svc.deleteSkill(name);
    return NextResponse.json({ deleted: name });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
