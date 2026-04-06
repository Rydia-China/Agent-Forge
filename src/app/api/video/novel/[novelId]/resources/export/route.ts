import { NextRequest, NextResponse } from "next/server";
import { exportResources } from "@/lib/services/resource-export-service";

/**
 * GET /api/video/novel/[novelId]/resources/export
 *
 * Download all novel-level resources as a zip archive.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ novelId: string }> },
) {
  const { novelId } = await params;

  try {
    const { stream, filename } = await exportResources(
      [{ scopeType: "novel", scopeId: novelId }],
      novelId,
    );

    const webStream = new ReadableStream({
      start(controller) {
        stream.on("data", (chunk: Buffer) => controller.enqueue(chunk));
        stream.on("end", () => controller.close());
        stream.on("error", (err) => controller.error(err));
      },
    });

    return new Response(webStream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
