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

export interface CreateTaskResponse {
  taskId: string;
  status: TaskStatus;
  requestId?: string;
}

export interface QueryTaskResponse {
  taskId: string;
  status: TaskStatus;
  videoUrl?: string;
  errorMessage?: string;
  requestId?: string;
}

/**
 * Create a HappyHorse video generation task
 */
export async function callFcHappyHorseCreate(
  request: CreateTaskRequest,
): Promise<CreateTaskResponse> {
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
      action: "create",
      ...request,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(
      `FC HappyHorse create failed (${response.status}): ${errorText}`
    );
  }

  const result: unknown = await response.json();

  if (
    typeof result === "object" &&
    result !== null &&
    "taskId" in result &&
    typeof result.taskId === "string" &&
    "status" in result &&
    typeof result.status === "string"
  ) {
    return result as CreateTaskResponse;
  }

  throw new Error(
    `FC HappyHorse create response invalid: ${JSON.stringify(result)}`
  );
}

/**
 * Query a HappyHorse task status
 */
export async function callFcHappyHorseQuery(
  taskId: string,
): Promise<QueryTaskResponse> {
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
      action: "query",
      taskId,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(
      `FC HappyHorse query failed (${response.status}): ${errorText}`
    );
  }

  const result: unknown = await response.json();

  if (
    typeof result === "object" &&
    result !== null &&
    "taskId" in result &&
    typeof result.taskId === "string" &&
    "status" in result &&
    typeof result.status === "string"
  ) {
    return result as QueryTaskResponse;
  }

  throw new Error(
    `FC HappyHorse query response invalid: ${JSON.stringify(result)}`
  );
}

/**
 * Wait for a HappyHorse task to complete
 */
export async function callFcHappyHorseWait(
  taskId: string,
  options?: {
    maxWaitTime?: number;
    pollInterval?: number;
    onProgress?: (status: TaskStatus) => void;
  },
): Promise<QueryTaskResponse> {
  const maxWaitTime = options?.maxWaitTime ?? 300000; // 5 minutes default
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitTime) {
    const result = await callFcHappyHorseQuery(taskId);

    if (options?.onProgress) {
      options.onProgress(result.status);
    }

    if (result.status === "SUCCEEDED" || result.status === "FAILED") {
      return result;
    }

    const elapsed = Date.now() - startTime;
    let interval: number;

    if (elapsed < 30000) {
      interval = 3000;
    } else if (elapsed < 120000) {
      interval = 5000;
    } else {
      interval = 10000;
    }

    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error("HappyHorse task timeout: exceeded maximum wait time");
}
