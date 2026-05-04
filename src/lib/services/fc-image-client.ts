/**
 * FC Image Generation Client
 * Calls the Function Compute image generation endpoint.
 */

const DEFAULT_IMAGE_MODEL = "gemini";
const DEFAULT_GEMINI_IMAGE_MODEL = "gemini-3-pro-image-preview";

type ImageProvider = "gpt" | "gemini";

function resolveImageModel(model?: string): { provider: ImageProvider; model: string } {
  const requestedModel = model?.trim();
  const effectiveModel = requestedModel && requestedModel.length > 0
    ? requestedModel
    : DEFAULT_IMAGE_MODEL;
  const normalizedModel = effectiveModel.toLowerCase();

  if (
    normalizedModel === "gpt" ||
    normalizedModel.startsWith("gpt-") ||
    normalizedModel.startsWith("openai/")
  ) {
    return { provider: "gpt", model: effectiveModel };
  }

  if (
    normalizedModel === "gemini" ||
    normalizedModel.startsWith("gemini-")
  ) {
    return {
      provider: "gemini",
      model: normalizedModel === "gemini" ? DEFAULT_GEMINI_IMAGE_MODEL : effectiveModel,
    };
  }

  throw new Error(
    `Unsupported image generation model "${effectiveModel}". ` +
    `Use "gpt", "gpt-*", "gemini", or "gemini-*".`
  );
}

export async function callFcGenerateImage(
  prompt: string,
  refUrls?: string[],
  model?: string,
): Promise<string> {
  const resolvedModel = resolveImageModel(model);

  // Select FC endpoint based on model
  let url: string | undefined;
  let token: string | undefined;
  if (resolvedModel.provider === "gpt") {
    url = process.env.FC_GENERATE_IMAGE_GPT_URL;
    token = process.env.FC_GENERATE_IMAGE_GPT_TOKEN;
  } else {
    url = process.env.FC_GENERATE_IMAGE_URL;
    token = process.env.FC_GENERATE_IMAGE_TOKEN;
  }

  console.log("[fc-image-client] Calling image FC", {
    provider: resolvedModel.provider,
    model: resolvedModel.model,
    referenceImageCount: refUrls?.length ?? 0,
  });

  if (!url || !token) {
    throw new Error(
      `FC endpoint not configured for model "${resolvedModel.model}". ` +
      `Check FC_GENERATE_IMAGE_GPT_URL/TOKEN (for gpt) or ` +
      `FC_GENERATE_IMAGE_URL/TOKEN (for gemini/gemini-* models) in .env`
    );
  }

  const payload: Record<string, unknown> = {
    prompt,
  };
  if (resolvedModel.provider === "gpt") {
    payload.model = resolvedModel.model;
  }
  if (refUrls && refUrls.length > 0) {
    payload.referenceImageUrls = refUrls;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(
      `FC image generation failed (${response.status}): ${errorText}`
    );
  }

  const result: unknown = await response.json();

  // Extract image URL from response - try multiple field names
  if (typeof result === "object" && result !== null) {
    // Check 'result' field (GPT FC returns this)
    if ("result" in result && typeof result.result === "string") {
      return result.result;
    }

    // Check 'imageUrl' field
    if ("imageUrl" in result && typeof result.imageUrl === "string") {
      return result.imageUrl;
    }

    // Check 'url' field
    if ("url" in result && typeof result.url === "string") {
      return result.url;
    }
  }

  throw new Error(
    `FC image generation response missing image URL field: ${JSON.stringify(result)}`
  );
}
