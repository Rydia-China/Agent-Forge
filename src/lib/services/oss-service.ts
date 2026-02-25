import OSS from "ali-oss";
import { z } from "zod";
import path from "node:path";

/* ------------------------------------------------------------------ */
/*  Zod schemas                                                       */
/* ------------------------------------------------------------------ */

export const UploadFromUrlParams = z.object({
  url: z.string().url(),
  folder: z.string().min(1).optional().default("file"),
  filename: z.string().min(1).optional(),
});

export const UploadBase64Params = z.object({
  data: z.string().min(1),
  filename: z.string().min(1),
  folder: z.string().min(1).optional().default("file"),
});

export const DeleteObjectParams = z.object({
  objectName: z.string().min(1),
});

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */

function createClient(): OSS {
  return new OSS({
    region: process.env.OSS_REGION!,
    accessKeyId: process.env.OSS_ACCESS_KEY_ID!,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET!,
    bucket: process.env.OSS_BUCKET!,
    endpoint: process.env.OSS_ENDPOINT || `oss-${process.env.OSS_REGION}.aliyuncs.com`,
    secure: true,
    timeout: 300000,
  });
}

function buildPublicUrl(objectName: string): string {
  const bucket = process.env.OSS_BUCKET!;
  const region = process.env.OSS_REGION!;
  return `https://${bucket}.oss-${region}.aliyuncs.com/${objectName}`;
}

/**
 * Generate filename with semantic prefix + short timestamp + random suffix.
 * Format: <prefix>-<short-time>-<random>.<ext>
 * Example: avatar-2k3f7g-a3f7k2p.png
 *
 * - Weak timestamp: base36 encoded (8 chars) instead of 13-digit number
 * - Strong semantic: extract meaningful prefix from original filename
 * - Short: ~20 chars total
 */
export function generateFilename(originalName: string, semanticPrefix?: string): string {
  const ext = path.extname(originalName) || "";
  const basename = path.basename(originalName, ext);

  // Extract semantic prefix: use provided or first meaningful word from filename
  let prefix = semanticPrefix || basename.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .split("-")
    .filter((w) => w.length > 2)[0] || "file";

  // Limit prefix length
  prefix = prefix.substring(0, 8);

  // Base36 timestamp (8 chars, no long digit sequences)
  const shortTime = Date.now().toString(36);

  // Random suffix (6 chars)
  const random = Math.random().toString(36).substring(2, 8);

  return `${prefix}-${shortTime}-${random}${ext}`;
}

/** Guess extension from Content-Type header. */
function extFromContentType(ct: string | null): string {
  if (!ct) return "";
  const map: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "application/pdf": ".pdf",
  };
  return map[ct.split(";")[0]!.trim()] ?? "";
}

/* ------------------------------------------------------------------ */
/*  Public service functions                                           */
/* ------------------------------------------------------------------ */

export async function uploadBuffer(
  buffer: Buffer,
  filename: string,
  folder: string = "file",
): Promise<string> {
  const client = createClient();
  const objectName = `public/${folder}/${filename}`;
  await client.put(objectName, buffer);
  return buildPublicUrl(objectName);
}

export async function uploadFromUrl(
  sourceUrl: string,
  folder: string = "file",
  filename?: string,
): Promise<{ url: string; objectName: string }> {
  const res = await fetch(sourceUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch source URL (${res.status} ${res.statusText})`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const resolvedName =
    filename ??
    generateFilename(
      path.basename(new URL(sourceUrl).pathname) ||
        `upload${extFromContentType(res.headers.get("content-type"))}`,
    );

  const objectName = `public/${folder}/${resolvedName}`;
  const client = createClient();
  await client.put(objectName, buffer);

  return { url: buildPublicUrl(objectName), objectName };
}

export async function deleteObject(objectName: string): Promise<void> {
  const client = createClient();
  await client.delete(objectName);
}

export async function batchUploadFromUrl(
  items: Array<{ url: string; folder?: string; filename?: string }>,
): Promise<Array<{ status: "ok"; url: string; objectName: string } | { status: "error"; error: string }>> {
  const results = await Promise.allSettled(
    items.map(({ url, folder, filename }) => uploadFromUrl(url, folder ?? "file", filename)),
  );
  return results.map((r) =>
    r.status === "fulfilled"
      ? { status: "ok" as const, url: r.value.url, objectName: r.value.objectName }
      : { status: "error" as const, error: r.reason instanceof Error ? r.reason.message : String(r.reason) },
  );
}

/**
 * Upload a base64 data URL (e.g. from clipboard/drag-drop) to OSS.
 * Returns the public HTTP URL.
 */
export async function uploadDataUrl(
  dataUrl: string,
  folder: string = "chat-images",
): Promise<string> {
  const match = dataUrl.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (!match) throw new Error("Invalid data URL format");

  const mimeType = match[1]!;
  const base64Data = match[2]!;
  const ext = extFromContentType(mimeType) || ".bin";
  const filename = generateFilename(`upload${ext}`);
  const buffer = Buffer.from(base64Data, "base64");

  return uploadBuffer(buffer, filename, folder);
}

export async function batchDelete(
  objectNames: string[],
): Promise<Array<{ objectName: string; status: "ok" | "error"; error?: string }>> {
  const results = await Promise.allSettled(
    objectNames.map((name) => deleteObject(name)),
  );
  return results.map((r, i) =>
    r.status === "fulfilled"
      ? { objectName: objectNames[i]!, status: "ok" as const }
      : { objectName: objectNames[i]!, status: "error" as const, error: r.reason instanceof Error ? r.reason.message : String(r.reason) },
  );
}
