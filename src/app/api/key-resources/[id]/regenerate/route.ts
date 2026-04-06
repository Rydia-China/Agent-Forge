import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { regenerateImage, regenerateVideo, getById } from "@/lib/services/key-resource-service";
import { pushNotification } from "@/lib/services/chat-session-service";

type Params = { params: Promise<{ id: string }> };

const BodySchema = z.object({
  prompt: z.string().min(1).optional(),
  session_id: z.string().optional(),
});

/** POST /api/key-resources/:id/regenerate */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  try {
    const resource = await getById(id);
    if (!resource) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    let result: { key: string; version: number };

    if (resource.mediaType === "video") {
      result = await regenerateVideo(id, parsed.data.prompt);
    } else if (resource.mediaType === "image") {
      result = await regenerateImage(id, parsed.data.prompt);
    } else {
      return NextResponse.json(
        { error: `Regeneration not supported for mediaType "${resource.mediaType}"` },
        { status: 400 },
      );
    }

    if (parsed.data.session_id) {
      await pushNotification(parsed.data.session_id, `key-resource "${result.key}" regenerated (v${result.version})`);
    }

    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
