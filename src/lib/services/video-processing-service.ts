/**
 * Video Processing Service — local ffmpeg-based video operations
 *
 * Uses ffmpeg-static (npm package with precompiled binaries).
 * Videos are downloaded from URLs, processed locally, and uploaded to OSS.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, unlink, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import ffmpegPath from "ffmpeg-static";
import { uploadBuffer } from "./oss-service";

const execAsync = promisify(exec);

const TEMP_DIR = path.join(process.cwd(), ".tmp", "video-processing");

if (!ffmpegPath) {
  throw new Error("ffmpeg-static binary not found");
}

async function ensureTempDir(): Promise<void> {
  if (!existsSync(TEMP_DIR)) {
    await mkdir(TEMP_DIR, { recursive: true });
  }
}

async function downloadVideo(url: string, destPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download video: ${response.statusText}`);
  }
  const buffer = await response.arrayBuffer();
  await writeFile(destPath, Buffer.from(buffer));
}

function generateTempPath(ext: string): string {
  return path.join(TEMP_DIR, `${crypto.randomUUID()}.${ext}`);
}

async function cleanupFiles(files: string[]): Promise<void> {
  await Promise.allSettled(files.map((file) => unlink(file)));
}

/**
 * Crop a video by time range using ffmpeg.
 * Downloads video, crops it, uploads to OSS, and returns the OSS URL.
 */
export async function cropVideo(
  videoUrl: string,
  startTime: number,
  endTime: number,
): Promise<string> {
  await ensureTempDir();

  const inputPath = generateTempPath("mp4");
  const outputPath = generateTempPath("mp4");

  try {
    // Download source video
    await downloadVideo(videoUrl, inputPath);

    // Crop using ffmpeg (-c copy for fast stream copy without re-encoding)
    const duration = endTime - startTime;
    await execAsync(
      `"${ffmpegPath}" -i "${inputPath}" -ss ${startTime} -t ${duration} -c copy "${outputPath}"`,
    );

    // Read output file and upload to OSS
    const buffer = await readFile(outputPath);
    const filename = `cropped-${Date.now()}.mp4`;
    const url = await uploadBuffer(buffer, filename, "video");

    return url;
  } finally {
    await cleanupFiles([inputPath, outputPath]);
  }
}

/**
 * Concatenate multiple video clips into a single video using ffmpeg.
 * Downloads all clips, concatenates them, uploads to OSS, and returns the OSS URL.
 */
export async function concatClips(clipUrls: string[]): Promise<string> {
  if (clipUrls.length === 0) {
    throw new Error("No clips provided for concatenation");
  }

  if (clipUrls.length === 1) {
    const firstUrl = clipUrls[0];
    if (!firstUrl) {
      throw new Error("Invalid clip URL");
    }
    // Single clip, just return it
    return firstUrl;
  }

  await ensureTempDir();

  const inputPaths: string[] = [];
  const outputPath = generateTempPath("mp4");
  const concatListPath = generateTempPath("txt");

  try {
    // Download all clips
    for (const url of clipUrls) {
      const inputPath = generateTempPath("mp4");
      await downloadVideo(url, inputPath);
      inputPaths.push(inputPath);
    }

    // Create concat list file for ffmpeg
    const concatList = inputPaths.map((p) => `file '${p}'`).join("\n");
    await writeFile(concatListPath, concatList);

    // Concatenate using ffmpeg
    await execAsync(
      `"${ffmpegPath}" -f concat -safe 0 -i "${concatListPath}" -c copy "${outputPath}"`,
    );

    // Read output file and upload to OSS
    const buffer = await readFile(outputPath);
    const filename = `concat-${Date.now()}.mp4`;
    const url = await uploadBuffer(buffer, filename, "video");

    return url;
  } finally {
    await cleanupFiles([...inputPaths, outputPath, concatListPath]);
  }
}
