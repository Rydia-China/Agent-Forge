import { NextRequest, NextResponse } from "next/server";
import { cancelSubAgent } from "@/lib/services/subagent-service";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const cancelled = await cancelSubAgent(id);
  if (!cancelled) {
    return NextResponse.json(
      { error: "SubAgent not found or already finished" },
      { status: 404 },
    );
  }
  return NextResponse.json({ cancelled: id });
}
