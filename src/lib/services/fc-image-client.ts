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
  const url = process.env.FC_GENERATE_IMAGE_URL;
  const token = process.env.FC_GENERATE_IMAGE_TOKEN;

  if (!url || !token) {
    throw new Error(
      "FC_GENERATE_IMAGE_URL and FC_GENERATE_IMAGE_TOKEN must be configured in .env"
    );
  }

  const payload: Record<string, unknown> = {
    prompt,
    model: model ?? DEFAULT_IMAGE_MODEL,
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
