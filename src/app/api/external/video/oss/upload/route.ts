import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateFilename, uploadBuffer } from "@/lib/services/oss-service";
import {
  authenticateExternalVideoApiKey,
  trackExternalVideoApiCall,
} from "@/lib/services/external-video-api-service";

const UploadToOssFormSchema = z.object({
  folder: z.string().trim().min(1).optional().default("file"),
  filename: z.string().trim().min(1).optional(),
  prefix: z.string().trim().min(1).optional(),
});

function readOptionalTextField(formData: FormData, name: string): unknown {
  const value = formData.get(name);
  if (value === null) return undefined;
  return value;
}

export async function POST(req: NextRequest) {
  const auth = authenticateExternalVideoApiKey(req.headers);
  if (auth.status === "not_configured") {
    return NextResponse.json({ error: auth.message }, { status: 503 });
  }
  if (auth.status === "unauthorized") {
    return NextResponse.json({ error: auth.message }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart form body" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing 'file' field" }, { status: 400 });
  }

  const parsed = UploadToOssFormSchema.safeParse({
    folder: readOptionalTextField(formData, "folder"),
    filename: readOptionalTextField(formData, "filename"),
    prefix: readOptionalTextField(formData, "prefix"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  try {
    const filename = parsed.data.filename ?? generateFilename(file.name, parsed.data.prefix);
    const buffer = Buffer.from(await file.arrayBuffer());
    const url = await trackExternalVideoApiCall(
      auth.apiKeyName,
      "oss.upload",
      () => uploadBuffer(buffer, filename, parsed.data.folder),
    );
    return NextResponse.json({
      status: "ok",
      product: "oss.upload",
      url,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
