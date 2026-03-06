import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  listEpisodes,
  createEpisode,
  runInitWorkflow,
} from "@/lib/services/video-workflow-service";

/** GET /api/video/novels/[novelId]/episodes — list all episodes for a novel */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ novelId: string }> },
) {
  const { novelId } = await params;
  try {
    const episodes = await listEpisodes(novelId);
    return NextResponse.json(episodes);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

const CreateEpisodeSchema = z.object({
  scriptKey: z.string().min(1),
  scriptName: z.string().nullable().optional(),
  scriptContent: z.string().nullable().optional(),
});

/** POST /api/video/novels/[novelId]/episodes — create (upload) an episode */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ novelId: string }> },
) {
  const { novelId } = await params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = CreateEpisodeSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  try {
    const episode = await createEpisode(
      novelId,
      parsed.data.scriptKey,
      parsed.data.scriptName ?? null,
      parsed.data.scriptContent ?? null,
    );

    // init_workflow is a hard prerequisite — errors must surface to the client.
    let initResult: Awaited<ReturnType<typeof runInitWorkflow>> | null = null;
    if (parsed.data.scriptContent) {
      initResult = await runInitWorkflow(
        novelId,
        episode.id,
        parsed.data.scriptContent,
      );
    }

    return NextResponse.json({ id: episode.id, initResult }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
