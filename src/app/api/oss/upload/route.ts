import { NextRequest, NextResponse } from "next/server";
import { uploadBuffer, generateFilename } from "@/lib/services/oss-service";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing 'file' field" }, { status: 400 });
  }

  const folder = (formData.get("folder") as string) || "file";
  const semanticPrefix = formData.get("prefix") as string | undefined;
  const filename =
    (formData.get("filename") as string) ||
    generateFilename(file.name, semanticPrefix);

  const buffer = Buffer.from(await file.arrayBuffer());
  const url = await uploadBuffer(buffer, filename, folder);

  return NextResponse.json({ url });
}
