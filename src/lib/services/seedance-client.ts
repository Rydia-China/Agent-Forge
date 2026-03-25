/**
 * Seedance 2.0 Video Generation Client
 *
 * Handles: login → submit task → poll status → return video URL.
 * Token is cached in memory and refreshed on expiry.
 */

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

function getConfig() {
  const baseUrl = process.env.SEEDANCE_API_BASE_URL;
  const username = process.env.SEEDANCE_USERNAME;
  const password = process.env.SEEDANCE_PASSWORD;
  if (!baseUrl || !username || !password) {
    throw new Error(
      "未配置 Seedance 视频生成服务 (SEEDANCE_API_BASE_URL, SEEDANCE_USERNAME, SEEDANCE_PASSWORD)",
    );
  }
  return { baseUrl, username, password };
}

/* ------------------------------------------------------------------ */
/*  Token cache                                                        */
/* ------------------------------------------------------------------ */

let cachedToken: string | null = null;
let tokenExpiresAt = 0; // epoch ms

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt - 30_000) {
    return cachedToken;
  }

  const { baseUrl, username, password } = getConfig();
  const res = await fetch(`${baseUrl}/api/user/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  const body = (await res.json()) as {
    code: number;
    message?: string;
    data?: { access_token: string; expires_in?: number };
  };

  if (body.code !== 200 || !body.data?.access_token) {
    throw new Error(`Seedance 登录失败: ${body.message ?? res.statusText}`);
  }

  cachedToken = body.data.access_token;
  // expires_in is in seconds; default 3600
  tokenExpiresAt = Date.now() + (body.data.expires_in ?? 3600) * 1000;
  return cachedToken;
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
/*  Submit task                                                        */
/* ------------------------------------------------------------------ */

async function submitTask(
  token: string,
  opts: SeedanceVideoOptions,
): Promise<string> {
  const { baseUrl } = getConfig();

  const res = await fetch(`${baseUrl}/api/ai/seedance/video`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      prompt: opts.prompt,
      model: opts.model ?? "seedance_2_0_fast",
      generate_type: opts.generateType ?? (opts.imageUrls?.length ? "first_frame" : "text_to_video"),
      image_urls: opts.imageUrls ?? [],
      video_urls: opts.videoUrls ?? [],
      audio_urls: opts.audioUrls ?? [],
      duration: opts.duration ?? 5,
      resolution: opts.resolution ?? "720p",
      aspect_ratio: opts.aspectRatio ?? "16:9",
      generate_audio: opts.generateAudio ?? true,
    }),
  });

  const body = (await res.json()) as {
    code: number;
    message?: string;
    data?: { public_task_id: string };
  };

  if (body.code !== 200 || !body.data?.public_task_id) {
    throw new Error(`Seedance 提交任务失败: ${body.message ?? res.statusText}`);
  }

  return String(body.data.public_task_id);
}

/* ------------------------------------------------------------------ */
/*  Poll task                                                          */
/* ------------------------------------------------------------------ */

interface TaskStatusResponse {
  code: number;
  data?: {
    status: "processing" | "success" | "failed";
    progress: number | null;
    result: string[] | null;
    save_urls?: string[] | null;
    error_message: string | null;
    timing?: { generate_ms?: number };
  };
}

async function pollTask(
  token: string,
  taskId: string,
  pollIntervalMs = 3000,
  maxAttempts = 120, // 6 min max
): Promise<{ videoUrl: string; saveUrl: string; timingMs: number }> {
  const { baseUrl } = getConfig();

  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(
      `${baseUrl}/api/ai/task/status?public_task_id=${taskId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    const body = (await res.json()) as TaskStatusResponse;

    if (body.data?.status === "success") {
      const videoUrl = body.data.result?.[0];
      if (!videoUrl) throw new Error("Seedance 任务成功但未返回视频 URL");
      return {
        videoUrl,
        saveUrl: body.data.save_urls?.[0] ?? videoUrl,
        timingMs: body.data.timing?.generate_ms ?? 0,
      };
    }

    if (body.data?.status === "failed") {
      throw new Error(
        `Seedance 视频生成失败: ${body.data.error_message ?? "unknown error"}`,
      );
    }

    // still processing
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  throw new Error("Seedance 视频生成超时");
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Generate a video via Seedance 2.0 API.
 * Blocks until the video is ready (typically 2–4 minutes).
 */
export async function generateVideo(
  opts: SeedanceVideoOptions,
): Promise<SeedanceVideoResult> {
  const token = await getToken();
  const taskId = await submitTask(token, opts);

  console.log(`[seedance] Task submitted: ${taskId}`);

  const result = await pollTask(token, taskId);

  console.log(
    `[seedance] Task ${taskId} done — ${result.timingMs}ms — ${result.saveUrl}`,
  );

  return {
    publicTaskId: taskId,
    videoUrl: result.videoUrl,
    saveUrl: result.saveUrl,
    timingMs: result.timingMs,
  };
}
