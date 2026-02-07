import { NextRequest, NextResponse } from "next/server";
import { listSessions } from "@/lib/services/chat-session-service";

/** GET /api/sessions?user=xxx — list sessions for a user */
export async function GET(req: NextRequest) {
  const user = req.nextUrl.searchParams.get("user") ?? undefined;
  const sessions = await listSessions(user);
  return NextResponse.json(sessions);
}
