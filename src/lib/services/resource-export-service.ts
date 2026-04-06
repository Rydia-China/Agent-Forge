/**
 * Resource Export Service — download all resource URLs and package into a zip.
 *
 * Uses `archiver` to stream-create a zip archive. Each resource file is
 * organized by category folder, with a sanitised filename derived from
 * the resource title (or key) and the original file extension.
 */

import archiver from "archiver";
import { PassThrough } from "node:stream";
import { listResourcesByScope, type ResourceItem } from "./key-resource-listing";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Extract file extension from a URL (before query string). */
function extFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const dot = pathname.lastIndexOf(".");
    if (dot !== -1) return pathname.slice(dot);
  } catch { /* malformed URL — fallback */ }
  return "";
}

/** Sanitise a string for use as a filename. */
function sanitise(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, "_").replace(/\s+/g, " ").trim() || "untitled";
}

/* ------------------------------------------------------------------ */
/*  Core                                                               */
/* ------------------------------------------------------------------ */

export interface ExportResult {
  /** Readable stream of the zip archive. */
  stream: PassThrough;
  /** Suggested filename for the download. */
  filename: string;
}

/**
 * Export all resources for one or more scopes into a zip archive.
 *
 * @param scopes  Array of { scopeType, scopeId } to include.
 * @param label   Human-readable label used in the zip filename.
 */
export async function exportResources(
  scopes: Array<{ scopeType: string; scopeId: string }>,
  label: string,
): Promise<ExportResult> {
  // Gather all category groups across scopes
  const allGroups = await Promise.all(
    scopes.map((s) => listResourcesByScope(s.scopeType, s.scopeId)),
  );

  // Merge categories
  const merged = new Map<string, ResourceItem[]>();
  for (const groups of allGroups) {
    for (const g of groups) {
      const existing = merged.get(g.category);
      if (existing) existing.push(...g.items);
      else merged.set(g.category, [...g.items]);
    }
  }

  // Setup archiver
  const archive = archiver("zip", { zlib: { level: 5 } });
  const passThrough = new PassThrough();
  archive.pipe(passThrough);

  // Track filenames to avoid collisions
  const usedPaths = new Set<string>();

  function uniquePath(base: string, ext: string): string {
    let path = `${base}${ext}`;
    if (!usedPaths.has(path)) {
      usedPaths.add(path);
      return path;
    }
    let i = 1;
    while (usedPaths.has(`${base}_${i}${ext}`)) i++;
    path = `${base}_${i}${ext}`;
    usedPaths.add(path);
    return path;
  }

  // Append files — fetch each URL and stream into archive
  const fetchPromises: Promise<void>[] = [];

  for (const [category, items] of merged) {
    const folderName = sanitise(category);

    for (const item of items) {
      if (!item.url) continue;

      const ext = extFromUrl(item.url);
      const baseName = sanitise(item.title ?? item.key);
      const filePath = uniquePath(`${folderName}/${baseName}`, ext);

      const url = item.url;
      fetchPromises.push(
        fetch(url)
          .then((resp) => {
            if (!resp.ok || !resp.body) {
              console.warn(`[resource-export] Failed to fetch ${url}: ${resp.status}`);
              return;
            }
            // Convert web ReadableStream to Node stream
            const reader = resp.body.getReader();
            const nodeStream = new PassThrough();
            function pump(): Promise<void> {
              return reader.read().then(({ done, value }) => {
                if (done) {
                  nodeStream.end();
                  return;
                }
                nodeStream.write(value);
                return pump();
              });
            }
            void pump();
            archive.append(nodeStream, { name: filePath });
          })
          .catch((err) => {
            console.warn(`[resource-export] Error fetching ${url}:`, err);
          }),
      );
    }
  }

  // Wait for all fetches to register, then finalise
  await Promise.all(fetchPromises);
  void archive.finalize();

  const safeName = sanitise(label);
  return {
    stream: passThrough,
    filename: `${safeName}-resources.zip`,
  };
}
