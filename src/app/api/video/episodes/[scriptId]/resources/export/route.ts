import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { exportEpisodeResources, resourceExportHeaders } from "@/lib/services/video-resource-export-service";

const ParamsSchema = z.object({
  scriptId: z.string().min(1),
});

const QuerySchema = z.object({
  novelId: z.string().min(1),
});

/** GET /api/video/episodes/[scriptId]/resources/export?novelId=xxx — export generated panel resources as zip */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ scriptId: string }> },
) {
  const parsedParams = ParamsSchema.safeParse(await params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: parsedParams.error.message }, { status: 400 });
  }

  const parsedQuery = QuerySchema.safeParse({
    novelId: req.nextUrl.searchParams.get("novelId"),
  });
  if (!parsedQuery.success) {
    return NextResponse.json({ error: parsedQuery.error.message }, { status: 400 });
  }

  try {
    const result = await exportEpisodeResources(parsedQuery.data.novelId, parsedParams.data.scriptId);
    return new Response(result.body, { headers: resourceExportHeaders(result.filename) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("No generated resources") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
