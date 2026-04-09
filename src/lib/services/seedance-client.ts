/**
 * Seedance 2.0 Video Generation Client (BytePlus Ark API)
 *
 * Uses the Volcengine / BytePlus Ark Content Generation API.
 * Flow: submit task → poll status → download & persist to OSS.
 *
 * Ark video URLs expire after 24 hours, so we always persist to OSS.
 */

import * as ossService from "./oss-service";

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

function getConfig() {
  const baseUrl = process.env.SEEDANCE_ARK_BASE_URL;
  const apiKey = process.env.SEEDANCE_ARK_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error(
      "未配置 Seedance Ark 视频生成服务 (SEEDANCE_ARK_BASE_URL, SEEDANCE_ARK_API_KEY)",
    );
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type SeedanceGenerateType =
  | "text_to_video"
  | "first_frame"
  | "first_last_frame"
  | "multimodal";

export type SeedanceModel = "seedance_2_0" | "seedance_2_0_fast";

export interface SeedanceVideoOptions {
  prompt: string;
  model?: SeedanceModel;
  generateType?: SeedanceGenerateType;
  imageUrls?: string[];
  videoUrls?: string[];
  audioUrls?: string[];
  duration?: number;
  resolution?: "480p" | "720p";
  aspectRatio?: string;
  generateAudio?: boolean;
}

export interface SeedanceVideoResult {
  publicTaskId: string;
  videoUrl: string;
  saveUrl: string;
  timingMs: number;
}

/* ------------------------------------------------------------------ */
/*  Ark model mapping                                                  */
/* ------------------------------------------------------------------ */

const ARK_MODEL_MAP: Record<SeedanceModel, string> = {
  seedance_2_0: "dreamina-seedance-2-0-fast-260128",
  seedance_2_0_fast: "dreamina-seedance-2-0-fast-260128",
};

/* ------------------------------------------------------------------ */
/*  Build content array                                                */
/* ------------------------------------------------------------------ */

interface ContentItem {
  type: string;
  text?: string;
  image_url?: { url: string };
  video_url?: { url: string };
  audio_url?: { url: string };
  role?: string;
}

function buildContentArray(opts: SeedanceVideoOptions): ContentItem[] {
  const content: ContentItem[] = [];

  // Text prompt (always first)
  content.push({ type: "text", text: opts.prompt });

  const images = opts.imageUrls ?? [];
  const videos = opts.videoUrls ?? [];
  const audios = opts.audioUrls ?? [];

  // Determine effective generate type
  const genType =
    opts.generateType ??
    (videos.length > 0 || audios.length > 0
      ? "multimodal"
      : images.length === 1
        ? "first_frame"
        : images.length >= 2
          ? "first_last_frame"
          : "text_to_video");

  // Images — role depends on generate type
  for (let i = 0; i < images.length; i++) {
    let role: string;
    if (genType === "first_frame" && i === 0) {
      role = "first_frame";
    } else if (genType === "first_last_frame") {
      role = i === 0 ? "first_frame" : i === 1 ? "last_frame" : "reference_image";
    } else {
      role = "reference_image";
    }
    content.push({
      type: "image_url",
      image_url: { url: images[i]! },
      role,
    });
  }

  // Reference videos
  for (const url of videos) {
    content.push({
      type: "video_url",
      video_url: { url },
      role: "reference_video",
    });
  }

  // Reference audios
  for (const url of audios) {
    content.push({
      type: "audio_url",
      audio_url: { url },
      role: "reference_audio",
    });
  }

  return content;
}

/* ------------------------------------------------------------------ */
/*  Submit task                                                        */
/* ------------------------------------------------------------------ */

async function submitTask(opts: SeedanceVideoOptions): Promise<string> {
  const { baseUrl, apiKey } = getConfig();

  const arkModel = ARK_MODEL_MAP[opts.model ?? "seedance_2_0_fast"];
  const content = buildContentArray(opts);

  const body: Record<string, unknown> = {
    model: arkModel,
    content,
    duration: opts.duration ?? 5,
    ratio: opts.aspectRatio ?? "9:16",
    generate_audio: opts.generateAudio ?? true,
    watermark: false,
  };

  if (opts.resolution) {
    body.resolution = opts.resolution;
  }

  const res = await fetch(`${baseUrl}/api/v3/contents/generations/tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Seedance Ark 提交任务失败 (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as { id?: string };
  if (!data.id) {
    throw new Error("Seedance Ark 提交任务未返回 task id");
  }

  return data.id;
}

/* ------------------------------------------------------------------ */
/*  Poll task                                                          */
/* ------------------------------------------------------------------ */

interface ArkTaskResponse {
  id: string;
  model: string;
  status: "queued" | "running" | "succeeded" | "failed" | "expired" | "cancelled";
  content?: {
    video_url?: string;
    last_frame_url?: string;
  };
  usage?: {
    completion_tokens: number;
    total_tokens: number;
  };
  error?: {
    code: string;
    message: string;
  };
  created_at?: number;
  updated_at?: number;
}

async function pollTask(
  taskId: string,
  pollIntervalMs = 5000,
  maxAttempts = 120, // 10 min max
): Promise<{ videoUrl: string; timingMs: number }> {
  const { baseUrl, apiKey } = getConfig();
  const startTime = Date.now();

  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(
      `${baseUrl}/api/v3/contents/generations/tasks/${taskId}`,
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
      },
    );

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Seedance Ark 查询任务失败 (${res.status}): ${errText}`);
    }

    const body = (await res.json()) as ArkTaskResponse;

    if (body.status === "succeeded") {
      const videoUrl = body.content?.video_url;
      if (!videoUrl) throw new Error("Seedance Ark 任务成功但未返回 video_url");
      return {
        videoUrl,
        timingMs: Date.now() - startTime,
      };
    }

    if (
      body.status === "failed" ||
      body.status === "expired" ||
      body.status === "cancelled"
    ) {
      throw new Error(
        `Seedance Ark 视频生成失败 (${body.status}): ${body.error?.message ?? "unknown error"}`,
      );
    }

    // still queued or running
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  throw new Error("Seedance Ark 视频生成超时");
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Generate a video via Seedance 2.0 (BytePlus Ark API).
 * Blocks until the video is ready (typically 2–4 minutes).
 * Downloads result and persists to OSS (Ark URLs expire in 24h).
 */
export async function generateVideo(
  opts: SeedanceVideoOptions,
): Promise<SeedanceVideoResult> {
  const taskId = await submitTask(opts);

  console.log(`[seedance-ark] Task submitted: ${taskId}`);

  const result = await pollTask(taskId);

  console.log(`[seedance-ark] Task ${taskId} done — ${result.timingMs}ms`);

  // Persist to OSS (Ark video URLs expire in 24h)
  const filename = ossService.generateFilename("video.mp4", "seedance");
  const oss = await ossService.uploadFromUrl(result.videoUrl, "video", filename);

  console.log(`[seedance-ark] Video persisted to OSS: ${oss.url}`);

  return {
    publicTaskId: taskId,
    videoUrl: result.videoUrl,
    saveUrl: oss.url,
    timingMs: result.timingMs,
  };
}
