import { NextRequest, NextResponse } from "next/server";
import { listTasksForNovel } from "@/lib/services/task-service";

type Params = { params: Promise<{ novelId: string }> };

/** GET /api/video/novels/:novelId/tasks — list tasks for a novel */
export async function GET(req: NextRequest, { params }: Params) {
  const { novelId } = await params;

  const limitRaw = req.nextUrl.searchParams.get("limit");
  const limit = limitRaw ? Math.min(100, Math.max(1, parseInt(limitRaw, 10))) : 50;

  const tasks = await listTasksForNovel(novelId, { limit });
  return NextResponse.json(tasks);
}
