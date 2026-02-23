import { NextRequest, NextResponse } from "next/server";
import { getTask } from "@/lib/services/task-service";

type Params = { params: Promise<{ id: string }> };

/** GET /api/tasks/:id — get task status */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const task = await getTask(id);
  if (!task) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(task);
}
