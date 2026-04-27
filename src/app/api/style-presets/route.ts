import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import * as stylePresetService from "@/lib/services/style-preset-service";

/** GET /api/style-presets — list all */
export async function GET() {
  try {
    const rows = await stylePresetService.list();
    return NextResponse.json(rows);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

const CreateSchema = z.object({
  name: z.string().min(1),
  prompt: z.string().min(1),
  referenceImageUrl: z.string().url().optional(),
});

/** POST /api/style-presets — create */
export async function POST(req: NextRequest) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = CreateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  try {
    const created = await stylePresetService.create(parsed.data);
    return NextResponse.json(created, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes("Unique constraint") ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
