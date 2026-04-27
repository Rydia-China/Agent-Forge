import { z } from "zod";

/**
 * GPT Image 2 API Client
 * Base URL: https://mm-internal-cn.leonecloud.com
 */

const CreateTaskResponseSchema = z.object({
  code: z.number(),
  msg: z.string(),
  data: z.object({
    taskId: z.string(),
    status: z.string(),
    createdAt: z.string(),
  }),
});

const QueryTaskResponseSchema = z.object({
  code: z.number(),
  msg: z.string(),
  data: z.object({
    taskId: z.string(),
    status: z.enum(["processing", "success", "failed"]),
    result: z.array(z.string()).optional(),
    errorMsg: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
});

interface GptImage2Options {
  baseUrl: string;
  token: string;
}

interface CreateTaskParams {
  prompt: string;
  genType?: "t2i" | "i2i";
  imageUrls?: string[];
  base64File?: string;
  aspectRatio?: "auto" | "1:1" | "16:9" | "9:16" | "5:4" | "4:5" | "3:2" | "2:3" | "4:3" | "3:4" | "21:9";
  callbackUrl?: string;
}

interface TaskStatus {
  taskId: string;
  status: "processing" | "success" | "failed";
  result?: string[];
  errorMsg?: string;
  createdAt: string;
  updatedAt: string;
}

export class GptImage2Client {
  private baseUrl: string;
  private token: string;

  constructor(options: GptImage2Options) {
    this.baseUrl = options.baseUrl;
    this.token = options.token;
  }

  /**
   * Create a GPT Image 2 generation task
   */
  async createTask(params: CreateTaskParams): Promise<string> {
    const url = `${this.baseUrl}/api/v2/open/aigc/gpt-image`;
    
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify(params),
    });

    const data: unknown = await response.json();
    const parsed = CreateTaskResponseSchema.parse(data);

    if (parsed.code !== 0) {
      throw new Error(`GPT Image 2 API error: ${parsed.msg}`);
    }

    return parsed.data.taskId;
  }

  /**
   * Query task status
   */
  async queryTask(taskId: string): Promise<TaskStatus> {
    const url = `${this.baseUrl}/api/v2/open/aigc/${taskId}`;
    
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
    });

    const data: unknown = await response.json();
    const parsed = QueryTaskResponseSchema.parse(data);

    if (parsed.code !== 0) {
      throw new Error(`GPT Image 2 API error: ${parsed.msg}`);
    }

    return parsed.data;
  }

  /**
   * Poll task until completion with exponential backoff
   * - First 30s: poll every 3s
   * - 30s ~ 2min: poll every 5s
   * - After 2min: poll every 10s
   */
  async pollTask(taskId: string, maxWaitMs = 300000): Promise<string[]> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitMs) {
      const status = await this.queryTask(taskId);
      
      if (status.status === "success") {
        if (!status.result || status.result.length === 0) {
          throw new Error("Task succeeded but no result returned");
        }
        return status.result;
      }
      
      if (status.status === "failed") {
        throw new Error(status.errorMsg ?? "Task failed with unknown error");
      }
      
      // Calculate wait time based on elapsed time
      const elapsed = Date.now() - startTime;
      let waitMs: number;
      if (elapsed < 30000) {
        waitMs = 3000; // 3s for first 30s
      } else if (elapsed < 120000) {
        waitMs = 5000; // 5s for 30s ~ 2min
      } else {
        waitMs = 10000; // 10s after 2min
      }
      
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    
    throw new Error(`Task polling timeout after ${maxWaitMs}ms`);
  }

  /**
   * Generate image and wait for result (convenience method)
   */
  async generateImage(params: CreateTaskParams): Promise<string[]> {
    const taskId = await this.createTask(params);
    return this.pollTask(taskId);
  }
}

/**
 * Create a GPT Image 2 client from environment variables
 */
export function createGptImage2Client(): GptImage2Client {
  const baseUrl = process.env.GPT_IMAGE2_BASE_URL;
  const token = process.env.GPT_IMAGE2_TOKEN;

  if (!baseUrl || !token) {
    throw new Error("GPT_IMAGE2_BASE_URL and GPT_IMAGE2_TOKEN must be configured in .env");
  }

  return new GptImage2Client({ baseUrl, token });
}
