import { z } from "zod";

/* ------------------------------------------------------------------ */
/*  FC Generate Image — shared client                                  */
/* ------------------------------------------------------------------ */

const FcResultSchema = z.object({
  result: z.string().optional(),
  error: z.string().optional(),
});

function getFcImageConfig() {
  const url = process.env.FC_GENERATE_IMAGE_URL;
  const token = process.env.FC_GENERATE_IMAGE_TOKEN;
  return { url, token };
}

/**
 * Call FC (Function Compute) to generate an image from a text prompt.
 * Returns the permanent OSS URL of the generated image.
 *
 * Throws on misconfiguration, network error, or FC error response.
 */
export async function callFcGenerateImage(
  prompt: string,
  referenceImageUrls?: string[],
  model?: string,
): Promise<string> {
  const fc = getFcImageConfig();
  if (!fc.url || !fc.token) {
    throw new Error("未配置 FC 图像生成服务 (FC_GENERATE_IMAGE_URL, FC_GENERATE_IMAGE_TOKEN)");
  }

  const res = await fetch(fc.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${fc.token}`,
    },
    body: JSON.stringify({ prompt, referenceImageUrls, ...(model && { model }) }),
  });

  const data: unknown = await res.json();
  const parsed = FcResultSchema.parse(data);

  if (!res.ok || parsed.error) {
    throw new Error(parsed.error ?? res.statusText);
  }
  if (!parsed.result) {
    throw new Error("FC returned no result");
  }

  return parsed.result;
}
