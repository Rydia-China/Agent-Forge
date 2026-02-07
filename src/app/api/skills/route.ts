import { NextRequest, NextResponse } from "next/server";
import * as svc from "@/lib/services/skill-service";

/** GET /api/skills — list all skills (metadata only) */
export async function GET() {
  const skills = await svc.listSkills();
  return NextResponse.json(skills);
}

/** POST /api/skills — create a skill (JSON or SKILL.md via text/markdown) */
export async function POST(req: NextRequest) {
  try {
    const ct = req.headers.get("content-type") ?? "";

    if (ct.includes("text/markdown")) {
      const raw = await req.text();
      const params = svc.SkillImportParams.parse({ skillMd: raw });
      const result = await svc.importSkill(params);
      return NextResponse.json(result, { status: 201 });
    }

    const body: unknown = await req.json();
    const params = svc.SkillCreateParams.parse(body);
    const result = await svc.createSkill(params);
    return NextResponse.json(result, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
