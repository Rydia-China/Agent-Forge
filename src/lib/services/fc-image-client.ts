/**
 * FC Image Generation Client
 * Calls the Function Compute image generation endpoint.
 */

const DEFAULT_IMAGE_MODEL = "gpt-image-2";

export async function callFcGenerateImage(
  prompt: string,
  refUrls?: string[],
  model?: string,
): Promise<string> {
  const effectiveModel = model ?? DEFAULT_IMAGE_MODEL;

  // Select FC endpoint based on model
  let url: string | undefined;
  let token: string | undefined;

  if (effectiveModel.startsWith("gpt-image")) {
    url = process.env.FC_GENERATE_IMAGE_GPT_URL;
    token = process.env.FC_GENERATE_IMAGE_GPT_TOKEN;
  } else if (effectiveModel.startsWith("gemini")) {
    url = process.env.FC_GENERATE_IMAGE_URL;
    token = process.env.FC_GENERATE_IMAGE_TOKEN;
  } else {
    // Default to GPT for unknown models
    url = process.env.FC_GENERATE_IMAGE_GPT_URL;
    token = process.env.FC_GENERATE_IMAGE_GPT_TOKEN;
  }

  if (!url || !token) {
    throw new Error(
      `FC endpoint not configured for model "${effectiveModel}". ` +
      `Check FC_GENERATE_IMAGE_GPT_URL/TOKEN (for gpt-image-*) or ` +
      `FC_GENERATE_IMAGE_URL/TOKEN (for gemini-*) in .env`
    );
  }

  const payload: Record<string, unknown> = {
    prompt,
    model: effectiveModel,
  };
  if (refUrls && refUrls.length > 0) {
    payload.refUrls = refUrls;
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

  // Extract image URL from response
  if (
    typeof result === "object" &&
    result !== null &&
    "imageUrl" in result &&
    typeof result.imageUrl === "string"
  ) {
    return result.imageUrl;
  }

  // Fallback: check for 'url' field
  if (
    typeof result === "object" &&
    result !== null &&
    "url" in result &&
    typeof result.url === "string"
  ) {
    return result.url;
  }

  throw new Error(
    `FC image generation response missing imageUrl field: ${JSON.stringify(result)}`
  );
}
