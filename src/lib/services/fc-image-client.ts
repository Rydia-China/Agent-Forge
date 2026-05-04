/**
 * Image generation client.
 * Calls the shared mob-ai-router /api/v1/generations endpoint.
 */

import { z } from "zod";

const DEFAULT_IMAGE_MODEL = "image-gemini-pro";
const IMAGE_GENERATION_TIMEOUT_MS = 620000;

const ImageGenerationResponseSchema = z.object({
  status: z.string(),
  output: z.object({
    type: z.literal("image"),
    url: z.string().url(),
  }).optional(),
  images: z.array(z.object({
    url: z.string().url(),
  })).optional(),
  result: z.string().url().optional(),
}).passthrough();

function resolveImageModel(model?: string): string {
  const requestedModel = model?.trim();
  const effectiveModel = requestedModel && requestedModel.length > 0
    ? requestedModel
    : DEFAULT_IMAGE_MODEL;
  const normalizedModel = effectiveModel.toLowerCase();

  if (
    normalizedModel === "image-gpt" ||
    normalizedModel === "gpt" ||
    normalizedModel.startsWith("gpt-") ||
    normalizedModel.startsWith("openai/")
  ) {
    return "image-gpt";
  }

  if (
    normalizedModel === "image-gemini-flash" ||
    normalizedModel === "gemini-flash" ||
    normalizedModel.includes("flash")
  ) {
    return "image-gemini-flash";
  }

  if (
    normalizedModel === "image-gemini-pro" ||
    normalizedModel === "gemini" ||
    normalizedModel === "gemini-pro" ||
    normalizedModel.startsWith("gemini-")
  ) {
    return "image-gemini-pro";
  }

  throw new Error(
    `Unsupported image generation model "${effectiveModel}". ` +
    `Use "image-gpt", "image-gemini-pro", "image-gemini-flash", ` +
    `"gpt", "gemini", or "gemini-flash".`
  );
}

function resolveGenerationsUrl(): string {
  const baseUrl = process.env.LLM_BASE_URL?.trim();
  if (!baseUrl) {
    throw new Error("LLM_BASE_URL must be configured to use image generation");
  }

  const normalized = baseUrl.replace(/\/+$/, "");
  if (normalized.endsWith("/chat/completions")) {
    return `${normalized.slice(0, -"/chat/completions".length)}/generations`;
  }
  if (normalized.endsWith("/api/v1") || normalized.endsWith("/v1")) {
    return `${normalized}/generations`;
  }
  return `${normalized}/api/v1/generations`;
}

function imageUrlFromResponse(data: unknown): string {
  const parsed = ImageGenerationResponseSchema.parse(data);
  if (parsed.status !== "succeeded") {
    throw new Error(`Image generation did not succeed: ${JSON.stringify(data)}`);
  }
  return parsed.output?.url ?? parsed.images?.[0]?.url ?? parsed.result ?? "";
}

export async function callFcGenerateImage(
  prompt: string,
  refUrls?: string[],
  model?: string,
): Promise<string> {
  const resolvedModel = resolveImageModel(model);
  const token = process.env.LLM_API_KEY;

  console.log("[fc-image-client] Calling image router", {
    model: resolvedModel,
    referenceImageCount: refUrls?.length ?? 0,
  });

  if (!token) {
    throw new Error("LLM_API_KEY must be configured to use image generation");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), IMAGE_GENERATION_TIMEOUT_MS);
  const body = {
    model: resolvedModel,
    input: {
      prompt,
      ...(refUrls && refUrls.length > 0 ? { referenceImageUrls: refUrls } : {}),
    },
  };

  try {
    const response = await fetch(resolveGenerationsUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await response.text();
    const result: unknown = text.length > 0 ? JSON.parse(text) : {};

    if (!response.ok) {
      throw new Error(
        `Image generation failed (${response.status}): ${JSON.stringify(result)}`
      );
    }

    const imageUrl = imageUrlFromResponse(result);
    if (imageUrl.length === 0) {
      throw new Error(
        `Image generation response missing output URL: ${JSON.stringify(result)}`
      );
    }
    return imageUrl;
  } finally {
    clearTimeout(timeoutId);
  }
}
