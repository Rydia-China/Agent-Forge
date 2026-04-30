import { prisma } from "@/lib/db";
import { listResourcesByScope, type ResourceCategoryGroup } from "@/lib/services/key-resource-listing";

interface ExportAsset {
  basePath: string;
  fallbackExtension: string;
  url: string;
}

interface ZipEntry {
  path: string;
  data: Uint8Array;
}

export interface ResourceExportResult {
  filename: string;
  body: Uint8Array;
  assetCount: number;
}

const textEncoder = new TextEncoder();

const extensionByContentType = new Map<string, string>([
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["video/mp4", "mp4"],
  ["video/webm", "webm"],
  ["video/quicktime", "mov"],
]);

const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i += 1) {
  let c = i;
  for (let j = 0; j < 8; j += 1) {
    c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[i] = c >>> 0;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (crc >>> 8) ^ (crcTable[(crc ^ byte) & 0xff] ?? 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function writeUint32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function sanitizeName(value: string): string {
  const normalized = value
    .trim()
    .replace(/[\\/:*?"<>|#%&{}$!'@+`=]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "untitled";
}

function extensionFromUrl(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    const last = pathname.split("/").pop() ?? "";
    const match = /\.([A-Za-z0-9]{2,5})$/.exec(last);
    return match?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

function extensionFromPath(path: string): string | null {
  const last = path.split("/").pop() ?? "";
  const match = /\.([A-Za-z0-9]{2,5})$/.exec(last);
  return match?.[1]?.toLowerCase() ?? null;
}

function extensionFromContentType(contentType: string | null): string | null {
  if (!contentType) return null;
  const mime = contentType.split(";")[0]?.trim().toLowerCase();
  if (!mime) return null;
  return extensionByContentType.get(mime) ?? null;
}

function contentDispositionFilename(filename: string): string {
  const ascii = sanitizeName(filename.replace(/\.zip$/i, "")) + ".zip";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function dosDateTime(date: Date): { date: number; time: number } {
  const year = Math.max(date.getFullYear(), 1980);
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { date: dosDate, time: dosTime };
}

function createZip(entries: ZipEntry[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  const now = dosDateTime(new Date());
  let offset = 0;

  for (const entry of entries) {
    const pathBytes = textEncoder.encode(entry.path);
    const checksum = crc32(entry.data);

    const localHeader = new Uint8Array(30 + pathBytes.byteLength);
    const localView = new DataView(localHeader.buffer);
    writeUint32(localView, 0, 0x04034b50);
    writeUint16(localView, 4, 20);
    writeUint16(localView, 6, 0x0800);
    writeUint16(localView, 8, 0);
    writeUint16(localView, 10, now.time);
    writeUint16(localView, 12, now.date);
    writeUint32(localView, 14, checksum);
    writeUint32(localView, 18, entry.data.byteLength);
    writeUint32(localView, 22, entry.data.byteLength);
    writeUint16(localView, 26, pathBytes.byteLength);
    writeUint16(localView, 28, 0);
    localHeader.set(pathBytes, 30);
    localParts.push(localHeader, entry.data);

    const centralHeader = new Uint8Array(46 + pathBytes.byteLength);
    const centralView = new DataView(centralHeader.buffer);
    writeUint32(centralView, 0, 0x02014b50);
    writeUint16(centralView, 4, 20);
    writeUint16(centralView, 6, 20);
    writeUint16(centralView, 8, 0x0800);
    writeUint16(centralView, 10, 0);
    writeUint16(centralView, 12, now.time);
    writeUint16(centralView, 14, now.date);
    writeUint32(centralView, 16, checksum);
    writeUint32(centralView, 20, entry.data.byteLength);
    writeUint32(centralView, 24, entry.data.byteLength);
    writeUint16(centralView, 28, pathBytes.byteLength);
    writeUint16(centralView, 30, 0);
    writeUint16(centralView, 32, 0);
    writeUint16(centralView, 34, 0);
    writeUint16(centralView, 36, 0);
    writeUint32(centralView, 38, 0);
    writeUint32(centralView, 42, offset);
    centralHeader.set(pathBytes, 46);
    centralParts.push(centralHeader);

    offset += localHeader.byteLength + entry.data.byteLength;
  }

  const centralDirectory = concatBytes(centralParts);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeUint32(endView, 0, 0x06054b50);
  writeUint16(endView, 4, 0);
  writeUint16(endView, 6, 0);
  writeUint16(endView, 8, entries.length);
  writeUint16(endView, 10, entries.length);
  writeUint32(endView, 12, centralDirectory.byteLength);
  writeUint32(endView, 16, offset);
  writeUint16(endView, 20, 0);

  return concatBytes([...localParts, centralDirectory, end]);
}

function assetsFromGroups(groups: ResourceCategoryGroup[]): ExportAsset[] {
  const assets: ExportAsset[] = [];
  const usedPaths = new Set<string>();

  for (const group of groups) {
    const category = sanitizeName(group.category);
    for (const item of group.items) {
      if (!item.url) continue;
      if (item.mediaType !== "image" && item.mediaType !== "video") continue;

      const baseName = sanitizeName(item.title ?? item.key);
      const extension = extensionFromUrl(item.url);
      const fallbackExtension = item.mediaType === "video" ? "mp4" : "jpg";
      const preferredPath = extension ? `${category}/${baseName}.${extension}` : `${category}/${baseName}`;
      let path = preferredPath;
      let duplicate = 2;
      while (usedPaths.has(path)) {
        path = extension ? `${category}/${baseName}-${duplicate}.${extension}` : `${category}/${baseName}-${duplicate}`;
        duplicate += 1;
      }
      usedPaths.add(path);
      assets.push({ basePath: path, fallbackExtension, url: item.url });
    }
  }

  return assets;
}

async function downloadAsset(asset: ExportAsset): Promise<ZipEntry | null> {
  const response = await fetch(asset.url);
  if (!response.ok) return null;

  const contentTypeExtension = extensionFromContentType(response.headers.get("content-type"));
  const currentExtension = extensionFromPath(asset.basePath);
  const path = currentExtension
    ? asset.basePath
    : `${asset.basePath}.${contentTypeExtension ?? asset.fallbackExtension}`;
  const buffer = await response.arrayBuffer();
  return { path, data: new Uint8Array(buffer) };
}

async function buildExport(groups: ResourceCategoryGroup[], filename: string): Promise<ResourceExportResult> {
  const assets = assetsFromGroups(groups);
  const entries = await Promise.all(assets.map(downloadAsset));
  const downloaded = entries.filter((entry): entry is ZipEntry => entry !== null);
  if (downloaded.length === 0) {
    throw new Error("No generated resources are available to export");
  }

  const manifest = {
    exportedAt: new Date().toISOString(),
    assetCount: downloaded.length,
    assets: downloaded.map((entry) => ({ path: entry.path })),
  };

  return {
    filename,
    body: createZip([
      { path: "manifest.json", data: textEncoder.encode(JSON.stringify(manifest, null, 2)) },
      ...downloaded,
    ]),
    assetCount: downloaded.length,
  };
}

export async function exportNovelResources(novelId: string): Promise<ResourceExportResult> {
  const novel = await prisma.novel.findUnique({
    where: { id: novelId },
    select: { name: true },
  });
  const groups = await listResourcesByScope("novel", novelId);
  const name = sanitizeName(novel?.name ?? novelId);
  return buildExport(groups, `${name}-novel-resources.zip`);
}

export async function exportEpisodeResources(novelId: string, scriptId: string): Promise<ResourceExportResult> {
  const [novel, script, novelGroups, scriptGroups] = await Promise.all([
    prisma.novel.findUnique({ where: { id: novelId }, select: { name: true } }),
    prisma.novelScript.findUnique({ where: { id: scriptId }, select: { scriptName: true, scriptKey: true } }),
    listResourcesByScope("novel", novelId),
    listResourcesByScope("script", scriptId),
  ]);

  const novelName = sanitizeName(novel?.name ?? novelId);
  const scriptName = sanitizeName(script?.scriptName ?? script?.scriptKey ?? scriptId);
  return buildExport([...novelGroups, ...scriptGroups], `${novelName}-${scriptName}-resources.zip`);
}

export function resourceExportHeaders(filename: string): Headers {
  return new Headers({
    "Content-Type": "application/zip",
    "Content-Disposition": contentDispositionFilename(filename),
    "Cache-Control": "no-store",
  });
}
