/**
 * FC Video Processing Client
 * Calls Function Compute endpoints for video generation, cropping, and concatenation.
 */

interface FcResult {
  result?: string;
  error?: string;
}

async function callFcEndpoint(
  url: string,
  token: string,
  body: Record<string, unknown>,
  timeoutMs = 120000,
): Promise<string> {
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

    const data = (await res.json()) as FcResult;

    if (!res.ok || data.error) {
      throw new Error(data.error ?? res.statusText);
    }
    if (!data.result) {
      throw new Error("FC returned no result");
    }

    return data.result;
  } finally {
    clearTimeout(timeoutId);
  }
}

export interface GenerateVideoOptions {
  prompt: string;
  sourceImageUrl?: string;
  styleName?: string;
  referenceImageUrls?: string[];
  sourceVideoUrls?: string[];
}

export async function callFcGenerateVideo(
  options: GenerateVideoOptions,
): Promise<string> {
  const url = process.env.FC_GENERATE_VIDEO_URL;
  const token = process.env.FC_GENERATE_VIDEO_TOKEN;

  if (!url || !token) {
    throw new Error(
      "FC_GENERATE_VIDEO_URL and FC_GENERATE_VIDEO_TOKEN must be configured in .env",
    );
  }

  return callFcEndpoint(
    url,
    token,
    {
      action: "generate",
      prompt: options.prompt,
      imageUrl: options.sourceImageUrl,
      styleName: options.styleName,
      referenceImageUrls: options.referenceImageUrls,
      sourceVideoUrls: options.sourceVideoUrls,
    },
    300000, // 5 minutes for video generation
  );
}

export interface CropVideoOptions {
  videoUrl: string;
  startTime: number;
  endTime: number;
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
