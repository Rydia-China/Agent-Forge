import { NextRequest, NextResponse } from "next/server";
import * as svc from "@/lib/services/skill-service";

type Params = { params: Promise<{ name: string; version: string }> };

/** GET /api/skills/:name/versions/:version — get specific version */
export async function GET(_req: NextRequest, { params }: Params) {
  const { name, version: vStr } = await params;
  const version = Number(vStr);
  if (!Number.isInteger(version) || version < 1) {
    return NextResponse.json({ error: "Invalid version number" }, { status: 400 });
  }

  const detail = await svc.getSkillVersion(name, version);
  if (!detail) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(detail);
}
