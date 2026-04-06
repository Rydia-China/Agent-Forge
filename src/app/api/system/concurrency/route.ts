import { NextResponse } from "next/server";
import { getConcurrencyStatus } from "@/lib/services/task-service";

/** GET /api/system/concurrency — current agent concurrency status */
export async function GET() {
  return NextResponse.json(getConcurrencyStatus());
}
