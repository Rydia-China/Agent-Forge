import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { execSync } from "node:child_process";
import { snapshotFiles, resolveProjectPath, restoreSnapshots } from "./snapshot.js";
import type { DiffMetadata } from "../types.js";

const DIFFS_DIR = join(import.meta.dirname, "../../diffs");

export function createDiff(id: string, description: string, filePaths: string[]): DiffMetadata {
  const diffDir = join(DIFFS_DIR, id);
  mkdirSync(diffDir, { recursive: true });

  snapshotFiles(id, filePaths);

  const metadata: DiffMetadata = {
    id,
    createdAt: new Date().toISOString(),
    description,
    reason: "",
    files: filePaths.map((fp) => ({
      path: fp,
      diffFile: `${basename(fp).replace(/\.\w+$/, "")}.diff`,
      snapshotFile: `before/${basename(fp)}`,
    })),
    status: "pending",
  };

  writeFileSync(join(diffDir, "metadata.json"), JSON.stringify(metadata, null, 2));
  return metadata;
}

export function saveDiff(id: string): void {
  const diffDir = join(DIFFS_DIR, id);
  const metaPath = join(diffDir, "metadata.json");
  const metadata = JSON.parse(readFileSync(metaPath, "utf-8")) as DiffMetadata;

  for (const file of metadata.files) {
    const currentPath = resolveProjectPath(file.path);
    const snapshotPath = join(diffDir, file.snapshotFile);

    if (!existsSync(currentPath) || !existsSync(snapshotPath)) continue;

    try {
      const diff = execSync(
        `diff -u "${snapshotPath}" "${currentPath}" || true`,
        { encoding: "utf-8" },
      );
      writeFileSync(join(diffDir, file.diffFile), diff);
    } catch {
      // diff may fail in unexpected ways
    }
  }

  metadata.status = "applied";
  metadata.appliedAt = new Date().toISOString();
  writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
}

export function showDiff(id: string): string {
  const diffDir = join(DIFFS_DIR, id);
  const metadata = JSON.parse(readFileSync(join(diffDir, "metadata.json"), "utf-8")) as DiffMetadata;
  const parts: string[] = [`Diff: ${id}\nDescription: ${metadata.description}\nStatus: ${metadata.status}\n`];

  for (const file of metadata.files) {
    const diffPath = join(diffDir, file.diffFile);
    if (existsSync(diffPath)) {
      parts.push(`--- ${file.path} ---\n${readFileSync(diffPath, "utf-8")}`);
    }
  }
  return parts.join("\n");
}

export function listDiffs(): DiffMetadata[] {
  let entries: string[];
  try {
    entries = readdirSync(DIFFS_DIR);
  } catch {
    return [];
  }
  const results: DiffMetadata[] = [];
  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    const metaPath = join(DIFFS_DIR, entry, "metadata.json");
    if (existsSync(metaPath)) {
      results.push(JSON.parse(readFileSync(metaPath, "utf-8")) as DiffMetadata);
    }
  }
  return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function revertDiff(id: string): void {
  const diffDir = join(DIFFS_DIR, id);
  const metaPath = join(diffDir, "metadata.json");
  const metadata = JSON.parse(readFileSync(metaPath, "utf-8")) as DiffMetadata;

  restoreSnapshots(id, metadata.files.map((f) => f.path));

  metadata.status = "reverted";
  writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
}

export function verifyDiff(id: string, evalId: string): void {
  const diffDir = join(DIFFS_DIR, id);
  const metaPath = join(diffDir, "metadata.json");
  const metadata = JSON.parse(readFileSync(metaPath, "utf-8")) as DiffMetadata;

  const evalsDir = join(import.meta.dirname, "../../evals");
  const summaryPath = join(evalsDir, evalId, "summary.json");
  if (existsSync(summaryPath)) {
    const summary = JSON.parse(readFileSync(summaryPath, "utf-8"));
    metadata.verifiedBy = {
      evalId,
      beforePassRate: 0,
      afterPassRate: summary.passRate ?? 0,
      afterAvgScore: summary.cases?.[0]?.avgScore,
    };
  }

  writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
}
