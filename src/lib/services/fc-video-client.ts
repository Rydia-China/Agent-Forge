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

export interface GeneratedVideoResult {
  videoUrl: string;
  lastFrameUrl?: string;
}

async function callFcEndpointResult<T>(
  url: string,
  token: string,
  body: Record<string, unknown>,
  resultSchema: z.ZodType<T>,
  timeoutMs = 120000,
): Promise<T> {
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

    const data = FcEnvelopeSchema.parse(await res.json());

    if (!res.ok || data.error) {
      throw new Error(data.error ?? res.statusText);
    }
    if (!data.result) {
      throw new Error("FC returned no result");
    }

    return resultSchema.parse(data.result);
  } finally {
    clearTimeout(timeoutId);
  }
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

  return callFcEndpointResult(
    url,
    token,
    {
      action: "generate",
      prompt: options.prompt,
      imageUrl: options.sourceImageUrl,
      styleName: options.styleName,
      referenceImageUrls: options.referenceImageUrls,
      sourceVideoUrls: options.sourceVideoUrls,
      duration: options.duration,
    },
    GenerateVideoResultSchema,
    900000, // 15 minutes for video generation
  );
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
