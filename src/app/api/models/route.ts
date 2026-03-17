import { NextResponse } from "next/server";
import { MODEL_OPTIONS, DEFAULT_MODEL } from "@/lib/agent/models";

/** GET /api/models — list available models for the controller */
export function GET() {
  return NextResponse.json({
    models: MODEL_OPTIONS.map((m) => ({
      id: m.id,
      label: m.label,
      maxContextTokens: m.maxContextTokens,
    })),
    default: DEFAULT_MODEL,
  });
}
