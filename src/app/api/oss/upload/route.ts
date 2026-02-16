import { NextRequest, NextResponse } from "next/server";
import { uploadBuffer } from "@/lib/services/oss-service";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing 'file' field" }, { status: 400 });
  }

  const folder = (formData.get("folder") as string) || "file";
  const filename =
    (formData.get("filename") as string) ||
    `${Date.now()}-${Math.random().toString(36).substring(2, 9)}-${file.name}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  const url = await uploadBuffer(buffer, filename, folder);

  return NextResponse.json({ url });
}
