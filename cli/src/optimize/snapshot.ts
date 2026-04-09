import { readFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

const DIFFS_DIR = join(import.meta.dirname, "../../diffs");
const PROJECT_ROOT = join(import.meta.dirname, "../../../");

export function resolveProjectPath(relativePath: string): string {
  return join(PROJECT_ROOT, relativePath);
}

/** Snapshot files into a diff's before/ directory. */
export function snapshotFiles(diffId: string, filePaths: string[]): void {
  const beforeDir = join(DIFFS_DIR, diffId, "before");
  mkdirSync(beforeDir, { recursive: true });
  for (const fp of filePaths) {
    const absPath = resolveProjectPath(fp);
    const dest = join(beforeDir, basename(fp));
    copyFileSync(absPath, dest);
  }
}

/** Restore files from before/ snapshots. */
export function restoreSnapshots(diffId: string, filePaths: string[]): void {
  for (const fp of filePaths) {
    const snapshotPath = join(DIFFS_DIR, diffId, "before", basename(fp));
    const destPath = resolveProjectPath(fp);
    copyFileSync(snapshotPath, destPath);
  }
}
