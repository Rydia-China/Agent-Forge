import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pushMessages } from "@/lib/services/chat-session-service";

type Params = { params: Promise<{ id: string }> };

const UploadResultSchema = z.object({
  uploadId: z.string().min(1),
  success: z.boolean(),
  url: z.string().optional(),
  filename: z.string().optional(),
  size: z.number().optional(),
  error: z.string().optional(),
});

/** POST /api/sessions/:id/upload-result — append upload outcome to chat history */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = UploadResultSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const { uploadId, success, url, filename, size, error } = parsed.data;

  let content: string;
  if (success) {
    const parts = ["[文件上传成功]"];
    if (url) parts.push(`url: ${url}`);
    if (filename) parts.push(`filename: ${filename}`);
    if (size != null) parts.push(`size: ${(size / 1024 / 1024).toFixed(2)}MB`);
    parts.push(`uploadId: ${uploadId}`);
    content = parts.join("\n");
  } else {
    content = `[文件上传取消] uploadId: ${uploadId}${error ? `\nerror: ${error}` : ""}`;
  }

  await pushMessages(id, [{ role: "user", content }]);

  return NextResponse.json({ ok: true, uploadId });
}
