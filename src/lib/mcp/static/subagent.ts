import { z } from "zod";
import OpenAI from "openai";
import Ajv from "ajv";
import type { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types";
import type { McpProvider, ToolContext } from "../types";

function text(t: string): CallToolResult {
  return { content: [{ type: "text", text: t }] };
}

function json(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/* ------------------------------------------------------------------ */
/*  OpenAI client (reuses main LLM proxy)                              */
/* ------------------------------------------------------------------ */

const g = globalThis as unknown as { __subagentClient?: OpenAI };

function getClient(): OpenAI {
  if (!g.__subagentClient) {
    const apiKey = process.env.LLM_API_KEY;
    if (!apiKey) throw new Error("LLM_API_KEY is not configured");
    g.__subagentClient = new OpenAI({
      apiKey,
      baseURL: process.env.LLM_BASE_URL || undefined,
    });
  }
  return g.__subagentClient;
}

/* ------------------------------------------------------------------ */
/*  JSON Schema validation (ajv)                                       */
/* ------------------------------------------------------------------ */

const ajv = new Ajv({ allErrors: true, verbose: true });

/** Strip markdown code fences that LLMs often wrap around JSON output. */
function stripMarkdownFences(raw: string): string {
  const trimmed = raw.trim();
  // Match ```json ... ``` or ``` ... ```
  const fenceRe = /^```(?:json|JSON)?\s*\n([\s\S]*?)\n\s*```$/;
  const match = fenceRe.exec(trimmed);
  return match ? match[1]!.trim() : trimmed;
}

interface ValidationSuccess {
  ok: true;
  data: unknown;
}

interface ValidationFailure {
  ok: false;
  error: string;
}

type ValidationResult = ValidationSuccess | ValidationFailure;

/**
 * Validate raw LLM text output against a JSON Schema.
 * Handles markdown fence stripping and JSON parse errors.
 */
function validateOutput(
  raw: string,
  schema: Record<string, unknown>,
): ValidationResult {
  const cleaned = stripMarkdownFences(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    return {
      ok: false,
      error: `JSON parse failed: ${
        e instanceof Error ? e.message : String(e)
      }\nRaw output (first 500 chars): ${cleaned.slice(0, 500)}`,
    };
  }

  const validate = ajv.compile(schema);
  if (validate(parsed)) {
    return { ok: true, data: parsed };
  }

  const errors = (validate.errors ?? []).map((err) => {
    const path = err.instancePath || "/";
    return `  ${path}: ${err.message}${err.params ? " " + JSON.stringify(err.params) : ""}`;
  });
  return {
    ok: false,
    error: `Schema validation failed:\n${errors.join("\n")}`,
  };
}

/* ------------------------------------------------------------------ */
/*  Zod schemas                                                        */
/* ------------------------------------------------------------------ */

const RunTextParams = z.object({
  tasks: z.array(
    z.object({
      prompt: z.string().min(1),
      model: z.string().min(1),
      imageUrls: z.array(z.string().url()).optional(),
      outputSchema: z.record(z.string(), z.unknown()).optional(),
      maxRetries: z.number().int().min(1).max(5).optional(),
      keyJsonTitle: z.string().min(1).optional(),
    }),
  ).min(1, "tasks array must not be empty"),
});

type TaskInput = z.infer<typeof RunTextParams>["tasks"][number];

/* ------------------------------------------------------------------ */
/*  Task execution with optional validation + retry                    */
/* ------------------------------------------------------------------ */

type MessageContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;

function buildContent(prompt: string, imageUrls?: string[]): MessageContent {
  if (imageUrls && imageUrls.length > 0) {
    return [
      { type: "text", text: prompt },
      ...imageUrls.map((url) => ({
        type: "image_url" as const,
        image_url: { url },
      })),
    ];
  }
  return prompt;
}

async function callLLM(
  client: OpenAI,
  model: string,
  content: MessageContent,
  signal?: AbortSignal,
): Promise<string> {
  const res = await client.chat.completions.create(
    {
      model,
      messages: [{ role: "user", content }],
    },
    { signal },
  );
  return res.choices[0]?.message.content ?? "";
}

interface TaskResult {
  status: "ok" | "error";
  result?: string;
  error?: string;
  /** Whether output was validated against a schema. */
  validated?: boolean;
  /** Number of attempts (1 = first try succeeded). */
  attempts?: number;
  /** Carried from task input — signals this result is a key JSON resource. */
  keyJsonTitle?: string;
}

async function executeTask(
  client: OpenAI,
  task: TaskInput,
  signal?: AbortSignal,
): Promise<TaskResult> {
  const content = buildContent(task.prompt, task.imageUrls);
  const raw = await callLLM(client, task.model, content, signal);

  // No schema → return raw text as before
  if (!task.outputSchema) {
    return { status: "ok", result: raw, keyJsonTitle: task.keyJsonTitle };
  }

  const maxRetries = task.maxRetries ?? 2;

  // Attempt 1: validate the initial output
  let validation = validateOutput(raw, task.outputSchema);
    if (validation.ok) {
      return {
        status: "ok",
        result: JSON.stringify(validation.data),
        validated: true,
        attempts: 1,
        keyJsonTitle: task.keyJsonTitle,
      };
    }

  // Retry loop with error context
  for (let attempt = 2; attempt <= maxRetries; attempt++) {
    console.warn(
      `[subagent] Task validation failed (attempt ${attempt - 1}/${maxRetries}), retrying with error context`,
    );

    const retryPrompt =
      task.prompt +
      "\n\n" +
      "[VALIDATION ERROR — your previous output failed schema validation]\n" +
      validation.error +
      "\n\n" +
      "Please fix the issues above and output ONLY valid JSON (no markdown fences, no extra text).";

    const retryContent = buildContent(retryPrompt, task.imageUrls);
    const retryRaw = await callLLM(client, task.model, retryContent, signal);
    validation = validateOutput(retryRaw, task.outputSchema);

    if (validation.ok) {
      return {
        status: "ok",
        result: JSON.stringify(validation.data),
        validated: true,
        attempts: attempt,
        keyJsonTitle: task.keyJsonTitle,
      };
    }
  }

  // All retries exhausted
  return {
    status: "error",
    error: `Schema validation failed after ${maxRetries} attempts.\nLast error: ${validation.error}`,
    validated: false,
    attempts: maxRetries,
  };
}

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

export const subagentMcp: McpProvider = {
  name: "subagent",

  async listTools(): Promise<Tool[]> {
    return [
      {
        name: "run_text",
        description:
          "Execute prompt(s) on specified model(s) via subagent. Accepts an array of tasks; all tasks run concurrently. " +
          "Each result includes status (ok/error) so partial failures are handled gracefully. " +
          "When outputSchema is provided, the subagent output is validated against the JSON Schema; " +
          "on validation failure it auto-retries with error context (up to maxRetries). " +
          "The result is guaranteed to conform to the schema when validated=true.",
        inputSchema: {
          type: "object" as const,
          properties: {
            tasks: {
              type: "array",
              description: "Array of prompt tasks to execute concurrently",
              items: {
                type: "object",
                properties: {
                  prompt: { type: "string", description: "The compiled prompt to execute" },
                  model: {
                    type: "string",
                    description: "Model name (e.g. 'google/gemini-3.1-pro-preview'). Required — no default.",
                  },
                  imageUrls: {
                    type: "array",
                    items: { type: "string" },
                    description: "Optional image URLs for multimodal prompts (vision tasks)",
                  },
                  outputSchema: {
                    type: "object",
                    description:
                      "Optional JSON Schema to validate the subagent output against. " +
                      "When provided, the output is parsed as JSON and validated; " +
                      "failures trigger auto-retry with error context.",
                  },
                  maxRetries: {
                    type: "number",
                    description:
                      "Max total attempts (including first try) when outputSchema is set. Default 2, max 5.",
                    default: 2,
                  },
                  keyJsonTitle: {
                    type: "string",
                    description:
                      "When set, the successful result is persisted as a key JSON resource with this title. " +
                      "Same session + same title = upsert (latest version kept).",
                  },
                },
                required: ["prompt", "model"],
              },
            },
          },
          required: ["tasks"],
        },
      },
    ];
  },

  async callTool(
    name: string,
    args: Record<string, unknown>,
    context?: ToolContext,
  ): Promise<CallToolResult> {
    switch (name) {
      case "run_text": {
        const { tasks } = RunTextParams.parse(args);
        const client = getClient();

        // Emit task list so the UI can show individual subagent cards
        context?.onProgress?.({
          type: "subagent_tasks",
          data: {
            tasks: tasks.map((t, i) => ({
              index: i,
              model: t.model,
              promptPreview: t.prompt.slice(0, 60),
            })),
          },
        });

        const taskTimers = tasks.map(() => Date.now());

        const results = await Promise.allSettled(
          tasks.map(async (task, i) => {
            const result = await executeTask(client, task, context?.signal);
            // Emit per-task completion
            context?.onProgress?.({
              type: "subagent_task_done",
              data: {
                index: i,
                status: result.status,
                durationMs: Date.now() - taskTimers[i]!,
              },
            });
            return result;
          }),
        );

        const output = results.map((r, i) =>
          r.status === "fulfilled"
            ? { index: i, ...r.value }
            : {
                index: i,
                status: "error" as const,
                error: r.reason instanceof Error ? r.reason.message : String(r.reason),
              },
        );
        return json(output);
      }

      default:
        return text(`Unknown tool: ${name}`);
    }
  },
};
