import sharp from "sharp";
import * as ossService from "./oss-service";

export interface ImageCompressionResult {
  originalUrl: string;
  compressedUrl: string;
  originalBytes: number;
  compressedBytes: number;
  format: string;
  uploaded: boolean;
  note?: string;
}

function filenameSafePrefix(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "image";
}

function extForFormat(format: string): string {
  if (format === "jpeg") return ".jpg";
  if (format === "png") return ".png";
  if (format === "webp") return ".webp";
  return ".png";
}

async function losslessCompress(buffer: Buffer): Promise<{ buffer: Buffer; format: string; note?: string }> {
  const image = sharp(buffer, { animated: false });
  const metadata = await image.metadata();
  const format = metadata.format ?? "unknown";

  if (format === "png") {
    return {
      buffer: await sharp(buffer)
        .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false })
        .toBuffer(),
      format,
    };
  }

  if (format === "webp") {
    return {
      buffer: await sharp(buffer)
        .webp({ lossless: true, effort: 6 })
        .toBuffer(),
      format,
    };
  }

  if (format === "jpeg" || format === "jpg") {
    return {
      buffer: await sharp(buffer)
        .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false })
        .toBuffer(),
      format: "jpeg",
      note: "jpeg converted to lossless png; original kept if conversion is larger",
    };
  }

  return {
    buffer: await sharp(buffer)
      .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false })
      .toBuffer(),
    format,
    note: `unsupported source format "${format}" converted to lossless png`,
  };
}

export async function compressImageUrlLossless(
  imageUrl: string,
  semanticPrefix: string,
): Promise<ImageCompressionResult> {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch image for compression (${response.status} ${response.statusText})`);
  }

  const original = Buffer.from(await response.arrayBuffer());
  const compressed = await losslessCompress(original);
  const originalBytes = original.byteLength;
  const compressedBytes = compressed.buffer.byteLength;

  if (compressedBytes >= originalBytes) {
    return {
      originalUrl: imageUrl,
      compressedUrl: imageUrl,
      originalBytes,
      compressedBytes: originalBytes,
      format: compressed.format,
      uploaded: false,
      note: compressed.note ?? "lossless compression was not smaller; using original URL",
    };
  }

  const filename = ossService.generateFilename(
    `${filenameSafePrefix(semanticPrefix)}${extForFormat(compressed.format)}`,
    "cmp",
  );
  const compressedUrl = await ossService.uploadBuffer(
    compressed.buffer,
    filename,
    "compressed-images",
  );

  return {
    originalUrl: imageUrl,
    compressedUrl,
    originalBytes,
    compressedBytes,
    format: compressed.format,
    uploaded: true,
    ...(compressed.note ? { note: compressed.note } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function compressedUrlFromResourceData(data: unknown): string | null {
  if (!isRecord(data)) return null;
  const imageCompression = data.imageCompression;
  if (!isRecord(imageCompression)) return null;
  return typeof imageCompression.compressedUrl === "string"
    ? imageCompression.compressedUrl
    : null;
}

export async function compressImageUrlLosslessBestEffort(
  imageUrl: string,
  semanticPrefix: string,
): Promise<ImageCompressionResult> {
  try {
    return await compressImageUrlLossless(imageUrl, semanticPrefix);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      originalUrl: imageUrl,
      compressedUrl: imageUrl,
      originalBytes: 0,
      compressedBytes: 0,
      format: "unknown",
      uploaded: false,
      note: `lossless compression failed; using original URL: ${message}`,
    };
  }
}
