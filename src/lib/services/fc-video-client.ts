/**
 * FC Video Processing Client
 * Calls Function Compute endpoints for video generation, cropping, and concatenation.
 */

import { z } from "zod";

const FcEnvelopeSchema = z.object({
  result: z.unknown().optional(),
  error: z.string().optional(),
});

const UrlResultSchema = z.string().url();
const ASYNC_VIDEO_INITIAL_POLL_DELAY_MS = 240000;
const ASYNC_VIDEO_POLL_INTERVAL_MS = 30000;
const ASYNC_VIDEO_POLL_TIMEOUT_MS = 900000;
const FC_SHORT_REQUEST_TIMEOUT_MS = 295000;

const GenerateVideoResultSchema = z.union([
  z.string().url().transform((videoUrl) => ({ videoUrl })),
  z.object({
    videoUrl: z.string().url(),
    lastFrameUrl: z.string().url().optional(),
  }),
  z.object({
    video_url: z.string().url(),
    last_frame_url: z.string().url().optional(),
  }).transform((value) => ({
    videoUrl: value.video_url,
    lastFrameUrl: value.last_frame_url,
  })),
]);

const SubmitVideoTaskResponseSchema = z.object({
  data: z.object({
    task_id: z.string().min(1),
  }),
  error: z.string().optional(),
}).passthrough();

const QueryVideoTaskResponseSchema = z.object({
  data: z.object({
    status: z.string().min(1),
    video_url: z.string().url().optional(),
    last_frame_url: z.string().url().optional(),
  }).passthrough(),
  error: z.string().optional(),
}).passthrough();

export interface GeneratedVideoResult {
  videoUrl: string;
  lastFrameUrl?: string;
}

function normalizeUniqueUrls(urls: Array<string | undefined>): string[] {
  return [...new Set(urls.filter((url): url is string => typeof url === "string" && url.length > 0))];
}

function unwrapFcPayload(data: unknown): unknown {
  const envelope = FcEnvelopeSchema.safeParse(data);
  if (!envelope.success) return data;

  if (envelope.data.error) {
    throw new Error(envelope.data.error);
  }
  if (envelope.data.result !== undefined) {
    return envelope.data.result;
  }

  return data;
}

function isTerminalFailedVideoStatus(status: string): boolean {
  return ["failed", "expired", "not_found", "cancelled", "canceled", "error"].includes(
    status.toLowerCase(),
  );
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function callFcJson(
  url: string,
  token: string,
  body: Record<string, unknown>,
  timeoutMs = 120000,
): Promise<unknown> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();
    const data: unknown = text.length > 0 ? JSON.parse(text) : {};
    const envelope = FcEnvelopeSchema.safeParse(data);
    const fcError = envelope.success ? envelope.data.error : undefined;

    if (!res.ok || fcError) {
      throw new Error(fcError ?? res.statusText);
    }

    return data;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callFcEndpointResult<T>(
  url: string,
  token: string,
  body: Record<string, unknown>,
  resultSchema: z.ZodType<T>,
  timeoutMs = 120000,
): Promise<T> {
  const data = FcEnvelopeSchema.parse(await callFcJson(url, token, body, timeoutMs));

  if (data.error) {
    throw new Error(data.error);
  }
  if (data.result === undefined) {
    throw new Error("FC returned no result");
  }

  return resultSchema.parse(data.result);
}

async function callFcEndpoint(
  url: string,
  token: string,
  body: Record<string, unknown>,
  timeoutMs = 120000,
): Promise<string> {
  return callFcEndpointResult(url, token, body, UrlResultSchema, timeoutMs);
}

export interface GenerateVideoOptions {
  prompt: string;
  sourceImageUrl?: string;
  styleName?: string;
  referenceImageUrls?: string[];
  sourceVideoUrls?: string[];
  duration?: number;
  ratio?: "16:9" | "9:16" | "1:1" | "4:3" | "3:4";
  resolution?: "1080P" | "720P";
}

async function submitFcGenerateVideoTask(
  url: string,
  token: string,
  options: GenerateVideoOptions,
): Promise<string> {
  const data = unwrapFcPayload(await callFcJson(
    url,
    token,
    {
      action: "CVSync2AsyncSubmitTask",
      prompt: options.prompt,
      image_urls: normalizeUniqueUrls([
        options.sourceImageUrl,
        ...(options.referenceImageUrls ?? []),
      ]),
      sourceVideoUrls: options.sourceVideoUrls,
      duration: options.duration,
      ratio: options.ratio,
      resolution: options.resolution,
    },
    FC_SHORT_REQUEST_TIMEOUT_MS,
  ));
  const parsed = SubmitVideoTaskResponseSchema.parse(data);
  if (parsed.error) {
    throw new Error(parsed.error);
  }
  return parsed.data.task_id;
}

async function queryFcGenerateVideoTask(
  url: string,
  token: string,
  taskId: string,
): Promise<z.infer<typeof QueryVideoTaskResponseSchema>["data"]> {
  const data = unwrapFcPayload(await callFcJson(
    url,
    token,
    {
      action: "CVSync2AsyncGetResult",
      task_id: taskId,
    },
    FC_SHORT_REQUEST_TIMEOUT_MS,
  ));
  const parsed = QueryVideoTaskResponseSchema.parse(data);
  if (parsed.error) {
    throw new Error(parsed.error);
  }
  return parsed.data;
}

async function pollFcGenerateVideoTask(
  url: string,
  token: string,
  taskId: string,
): Promise<GeneratedVideoResult> {
  const deadline = Date.now() + ASYNC_VIDEO_POLL_TIMEOUT_MS;
  let lastStatus = "submitted";

  await delay(ASYNC_VIDEO_INITIAL_POLL_DELAY_MS);

  while (Date.now() < deadline) {
    const result = await queryFcGenerateVideoTask(url, token, taskId);
    lastStatus = result.status;

    if (result.status.toLowerCase() === "done" && result.video_url) {
      return GenerateVideoResultSchema.parse({
        video_url: result.video_url,
        last_frame_url: result.last_frame_url,
      });
    }
    if (isTerminalFailedVideoStatus(result.status)) {
      throw new Error(`Video generation task ${taskId} failed with status ${result.status}`);
    }
    await delay(ASYNC_VIDEO_POLL_INTERVAL_MS);
  }

  throw new Error(`Video generation task ${taskId} timed out, last status: ${lastStatus}`);
}

export async function callFcGenerateVideo(
  options: GenerateVideoOptions,
): Promise<GeneratedVideoResult> {
  const url = process.env.FC_GENERATE_VIDEO_URL;
  const token = process.env.FC_GENERATE_VIDEO_TOKEN;

  if (!url || !token) {
    throw new Error(
      "FC_GENERATE_VIDEO_URL and FC_GENERATE_VIDEO_TOKEN must be configured in .env",
    );
  }

  const taskId = await submitFcGenerateVideoTask(url, token, options);
  return pollFcGenerateVideoTask(url, token, taskId);
}

export interface ExtractLastFrameOptions {
  videoUrl: string;
}

export async function callFcExtractLastFrame(
  options: ExtractLastFrameOptions,
): Promise<string> {
  const url = process.env.FC_EXTRACT_LAST_FRAME_URL;
  const token = process.env.FC_EXTRACT_LAST_FRAME_TOKEN;

  if (!url || !token) {
    throw new Error(
      "FC_EXTRACT_LAST_FRAME_URL and FC_EXTRACT_LAST_FRAME_TOKEN must be configured in .env",
    );
  }

  return callFcEndpoint(url, token, {
    videoUrl: options.videoUrl,
  });
}

export interface CropVideoOptions {
  videoUrl: string;
  startTime?: number;
  endTime?: number;
  tailSeconds?: number;
}

export async function callFcCropVideo(
  options: CropVideoOptions,
): Promise<string> {
  const url = process.env.FC_CROP_VIDEO_URL;
  const token = process.env.FC_CROP_VIDEO_TOKEN;

  if (!url || !token) {
    throw new Error(
      "FC_CROP_VIDEO_URL and FC_CROP_VIDEO_TOKEN must be configured in .env",
    );
  }

  return callFcEndpoint(url, token, {
    videoUrl: options.videoUrl,
    startTime: options.startTime,
    endTime: options.endTime,
    tailSeconds: options.tailSeconds,
  });
}

export interface ConcatClipsOptions {
  clipUrls: string[];
}

export async function callFcConcatClips(
  options: ConcatClipsOptions,
): Promise<string> {
  const url = process.env.FC_CONCAT_CLIPS_URL;
  const token = process.env.FC_CONCAT_CLIPS_TOKEN;

  if (!url || !token) {
    throw new Error(
      "FC_CONCAT_CLIPS_URL and FC_CONCAT_CLIPS_TOKEN must be configured in .env",
    );
  }

  return callFcEndpoint(url, token, {
    clipUrls: options.clipUrls,
  });
}
