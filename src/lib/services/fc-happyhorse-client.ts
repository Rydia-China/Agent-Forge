/**
 * FC HappyHorse Video Generation Client
 * Wraps DashScope HappyHorse API as Function Compute endpoint.
 */

export type Resolution = '1080P' | '720P';
export type Ratio = '16:9' | '9:16' | '1:1' | '4:3' | '3:4';
export type TaskStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';

export interface MediaItem {
  type: 'video' | 'reference_image';
  url: string;
}

export interface CreateTaskRequest {
  prompt: string;
  media: MediaItem[];
  resolution?: Resolution;
  ratio?: Ratio;
  duration?: number;
  model?: string;
}

export interface GenerateVideoResponse {
  taskId: string;
  status: string;
  videoUrl: string;
  originalVideoUrl?: string;
}

/**
 * Generate HappyHorse video (synchronous mode)
 * FC handles: create → poll → download → upload to OSS
 */
export async function callFcHappyHorseGenerate(
  request: CreateTaskRequest,
): Promise<GenerateVideoResponse> {
  const url = process.env.FC_HAPPYHORSE_URL;
  const token = process.env.FC_HAPPYHORSE_TOKEN;

  if (!url || !token) {
    throw new Error(
      "FC_HAPPYHORSE_URL and FC_HAPPYHORSE_TOKEN must be configured in .env"
    );
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({
      action: "generate",
      ...request,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(
      `FC HappyHorse generate failed (${response.status}): ${errorText}`
    );
  }

  const result: unknown = await response.json();

  if (
    typeof result === "object" &&
    result !== null &&
    "taskId" in result &&
    typeof result.taskId === "string" &&
    "status" in result &&
    typeof result.status === "string" &&
    "videoUrl" in result &&
    typeof result.videoUrl === "string"
  ) {
    return result as GenerateVideoResponse;
  }

  throw new Error(
    `FC HappyHorse generate response invalid: ${JSON.stringify(result)}`
  );
}
