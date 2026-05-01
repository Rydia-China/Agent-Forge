import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { uploadImageVersion } from "@/lib/services/key-resource-service";

type Params = { params: Promise<{ id: string }> };

const MAX_IMAGE_UPLOAD_BYTES = 25 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

const UploadImageFormSchema = z.object({
  file: z.custom<File>((value): value is File => value instanceof File, {
    message: "Missing 'file' field",
  })
    .refine((file) => ALLOWED_IMAGE_TYPES.has(file.type), {
      message: "Only png, jpeg, webp, or gif images are supported",
    })
    .refine((file) => file.size <= MAX_IMAGE_UPLOAD_BYTES, {
      message: "Image upload must be 25MB or smaller",
    }),
  filename: z.string().trim().min(1).optional(),
});

function readOptionalTextField(formData: FormData, name: string): unknown {
  const value = formData.get(name);
  if (value === null) return undefined;
  return value;
}

/** POST /api/key-resources/:id/upload — upload an image as a new version */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart form body" }, { status: 400 });
  }

  const parsed = UploadImageFormSchema.safeParse({
    file: formData.get("file"),
    filename: readOptionalTextField(formData, "filename"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await parsed.data.file.arrayBuffer());
    const result = await uploadImageVersion({
      id,
      buffer,
      originalName: parsed.data.file.name,
      filename: parsed.data.filename,
    });
    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
