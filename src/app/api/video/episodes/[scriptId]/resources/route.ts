import { NextRequest, NextResponse } from "next/server";
import { getResources, updateResourceData, deleteResource } from "@/lib/services/video-workflow-service";

/** GET /api/video/episodes/[scriptId]/resources?novelId=xxx — get episode resources */
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
    const resources = await getResources(scriptId, novelId);
    return NextResponse.json(resources);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** PATCH /api/video/episodes/[scriptId]/resources — update a domain resource's data */
export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as { resourceId?: string; data?: unknown };
    if (!body.resourceId || body.data === undefined) {
      return NextResponse.json({ error: "Missing resourceId or data" }, { status: 400 });
    }
    await updateResourceData(body.resourceId, body.data);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** DELETE /api/video/episodes/[scriptId]/resources — delete a single domain resource */
export async function DELETE(req: NextRequest) {
  try {
    const body = (await req.json()) as { resourceId?: string };
    if (!body.resourceId) {
      return NextResponse.json({ error: "Missing resourceId" }, { status: 400 });
    }
    await deleteResource(body.resourceId);
    return NextResponse.json({ deleted: body.resourceId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
