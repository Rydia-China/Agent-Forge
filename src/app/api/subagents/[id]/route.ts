import { NextRequest, NextResponse } from "next/server";
import { getSubAgent } from "@/lib/services/subagent-service";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const subagent = await getSubAgent(id);
  if (!subagent) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(subagent);
}
