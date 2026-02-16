import { NextRequest, NextResponse } from "next/server";
import { callApiOperation } from "@/lib/services/api-service";

type Params = { params: Promise<{ name: string; operation: string }> };

/** POST /api/public/:name/:operation — invoke API operation */
export async function POST(req: NextRequest, { params }: Params) {
  const { name, operation } = await params;

  let body: Record<string, unknown> = {};
  try {
    const raw: unknown = await req.json();
    if (typeof raw === "object" && raw !== null) {
      body = raw as Record<string, unknown>;
    }
  } catch {
    // empty body is fine — some operations have no params
  }

  try {
    const result = await callApiOperation(name, operation, body);
    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);

    // Distinguish client errors from server errors
    const isClientError =
      msg.includes("not found") ||
      msg.includes("disabled") ||
      msg.includes("Missing required parameter");

    return NextResponse.json(
      { error: msg },
      { status: isClientError ? 400 : 500 },
    );
  }
}
