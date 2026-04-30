import { NextResponse } from "next/server";
import { z } from "zod";
import { exportNovelResources, resourceExportHeaders } from "@/lib/services/video-resource-export-service";

const ParamsSchema = z.object({
  novelId: z.string().min(1),
});

/** GET /api/video/novel/[novelId]/resources/export — export generated novel resources as zip */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ novelId: string }> },
) {
  const parsed = ParamsSchema.safeParse(await params);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  try {
    const result = await exportNovelResources(parsed.data.novelId);
    return new Response(result.body, { headers: resourceExportHeaders(result.filename) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("No generated resources") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
