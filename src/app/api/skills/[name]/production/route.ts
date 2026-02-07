import { NextRequest, NextResponse } from "next/server";
import * as svc from "@/lib/services/skill-service";

type Params = { params: Promise<{ name: string }> };

/** PUT /api/skills/:name/production — set production version { version: N } */
export async function PUT(req: NextRequest, { params }: Params) {
  const { name } = await params;
  try {
    const body: unknown = await req.json();
    const { version } = svc.SkillSetProductionParams.omit({ name: true }).parse(body);
    const skill = await svc.setSkillProduction(name, version);
    return NextResponse.json({ name: skill.name, productionVersion: skill.productionVersion });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
