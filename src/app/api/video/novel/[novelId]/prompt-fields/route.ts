import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { updateNovelField } from "@/lib/services/video-workflow-service";

const PatchBody = z.object({
  target: z.enum(["character", "location", "sub_location"]),
  name: z.string().min(1),
  field: z.string().min(1),
  value: z.string(),
  parentName: z.string().min(1).optional(),
});

/** PATCH /api/video/novel/[novelId]/prompt-fields */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ novelId: string }> },
) {
  const { novelId } = await params;

  let body: z.infer<typeof PatchBody>;
  try {
    const raw: unknown = await req.json();
    body = PatchBody.parse(raw);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Invalid request body";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    await updateNovelField(
      novelId,
      body.target,
      body.name,
      body.field,
      body.value,
      body.parentName,
    );
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Update failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
