import { NextRequest, NextResponse } from "next/server";
import { exportResources } from "@/lib/services/resource-export-service";

/**
 * GET /api/video/episodes/[scriptId]/resources/export?novelId=xxx
 *
 * Download all episode + novel resources as a zip archive.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ scriptId: string }> },
) {
  const { scriptId } = await params;
  const novelId = req.nextUrl.searchParams.get("novelId");

  if (!novelId) {
    return NextResponse.json({ error: "Missing novelId query parameter" }, { status: 400 });
  }

  try {
    const { stream, filename } = await exportResources(
      [
        { scopeType: "novel", scopeId: novelId },
        { scopeType: "script", scopeId: scriptId },
      ],
      scriptId,
    );

    // Convert Node PassThrough to a web ReadableStream
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
