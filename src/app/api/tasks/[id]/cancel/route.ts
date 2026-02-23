import { NextRequest, NextResponse } from "next/server";
import { cancelTask } from "@/lib/services/task-service";

type Params = { params: Promise<{ id: string }> };

/** POST /api/tasks/:id/cancel — cancel a running task */
export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const cancelled = await cancelTask(id);
  if (!cancelled) {
    return NextResponse.json(
      { error: "Task not found or already finished" },
      { status: 404 },
    );
  }
  return NextResponse.json({ cancelled: id });
}
