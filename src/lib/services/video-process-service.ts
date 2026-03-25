/**
 * Video processing service using bundled ffmpeg binary.
 * Zero system dependencies — ffmpeg is provided by @ffmpeg-installer/ffmpeg.
 */

import { path as ffmpegPath } from "@ffmpeg-installer/ffmpeg";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeFile, readFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);

/* ------------------------------------------------------------------ */
/*  Duration probe                                                     */
/* ------------------------------------------------------------------ */

async function probeDuration(inputPath: string): Promise<number> {
  try {
    // ffmpeg -i without output exits non-zero but prints info to stderr
    await execFileAsync(ffmpegPath, ["-i", inputPath]);
  } catch (err: unknown) {
    const stderr =
      err instanceof Error && "stderr" in err
        ? (err as Error & { stderr: string }).stderr
        : "";
    const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
    if (m) {
      return (
        parseInt(m[1]!) * 3600 +
        parseInt(m[2]!) * 60 +
        parseInt(m[3]!) +
        parseInt(m[4]!) / 100
      );
    }
  }
  throw new Error("无法解析视频时长");
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Extract a segment from a video by time range.
 *
 * @param sourceUrl  - URL of the source video
 * @param startSec   - Start time in seconds (inclusive)
 * @param endSec     - End time in seconds (exclusive), or null to extract till the end
 * @returns Buffer of the extracted video clip (mp4)
 *
 * @example
 * // Extract from 3s to 5s
 * extractVideoSegment(url, 3, 5)
 *
 * // Extract first 3 seconds
 * extractVideoSegment(url, 0, 3)
 *
 * // Extract last 5 seconds (pass null for endSec, then it auto-calculates)
 * const duration = await probeDuration(...);
 * extractVideoSegment(url, duration - 5, null)
 */
export async function extractVideoSegment(
  sourceUrl: string,
  startSec: number,
  endSec: number | null,
): Promise<Buffer> {
  const id = randomUUID();
  const inputPath = join(tmpdir(), `trim-in-${id}.mp4`);
  const outputPath = join(tmpdir(), `trim-out-${id}.mp4`);

  try {
    // 1. Download source video
    const res = await fetch(sourceUrl);
    if (!res.ok) throw new Error(`下载视频失败: ${res.status} ${res.statusText}`);
    await writeFile(inputPath, Buffer.from(await res.arrayBuffer()));

    // 2. Probe duration for validation
    const duration = await probeDuration(inputPath);
    const effectiveEnd = endSec ?? duration;

    if (startSec < 0 || startSec >= duration) {
      throw new Error(`起始时间 ${startSec}s 超出视频范围 [0, ${duration.toFixed(1)}s)`);
    }
    if (effectiveEnd <= startSec) {
      throw new Error(`结束时间 ${effectiveEnd}s 必须大于起始时间 ${startSec}s`);
    }
    if (effectiveEnd > duration) {
      throw new Error(`结束时间 ${effectiveEnd}s 超出视频总时长 ${duration.toFixed(1)}s`);
    }

    // 3. Extract segment: -ss (start) -to (end)
    const args = [
      "-ss", String(startSec),
      "-i", inputPath,
    ];
    if (endSec !== null) {
      args.push("-to", String(endSec));
    }
    args.push("-c", "copy", "-y", outputPath);

    await execFileAsync(ffmpegPath, args);

    // 4. Read result
    return await readFile(outputPath);
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}

