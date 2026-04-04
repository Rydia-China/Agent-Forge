import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { NovelScriptUploadSchema } from "@/lib/video/script-upload-schema";
import {
  listNovels,
  createNovelWithScript,
} from "@/lib/services/video-workflow-service";

/** GET /api/video/novels — list all novels (local) */
export async function GET() {
  try {
    const novels = await listNovels();
    return NextResponse.json(novels);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

const CreateNovelSchema = z.object({
  name: z.string().min(1),
  episodes: NovelScriptUploadSchema,
});

/** POST /api/video/novels — create novel with JSON script upload */
export async function POST(req: NextRequest) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = CreateNovelSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  try {
    const result = await createNovelWithScript(
      parsed.data.name,
      parsed.data.episodes,
    );
    return NextResponse.json(result, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
