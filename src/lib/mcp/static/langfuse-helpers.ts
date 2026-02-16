import { z } from "zod";

/* ------------------------------------------------------------------ */
/*  Config & fetch                                                     */
/* ------------------------------------------------------------------ */

export function getLangfuseConfig() {
  const baseUrl = process.env.LANGFUSE_BASE_URL;
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  if (!baseUrl || !publicKey || !secretKey) {
    throw new Error("Langfuse 未配置 (LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY)");
  }
  const auth = Buffer.from(`${publicKey}:${secretKey}`).toString("base64");
  return { baseUrl: baseUrl.replace(/\/+$/, ""), auth };
}

export async function langfuseFetch(
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const { baseUrl, auth } = getLangfuseConfig();
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${auth}`,
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Langfuse API ${res.status}: ${body || res.statusText}`);
  }
  return res.json();
}

/* ------------------------------------------------------------------ */
/*  Template compilation: {{var}} → value                              */
/* ------------------------------------------------------------------ */

export function compileTemplate(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    return key in variables ? variables[key]! : match;
  });
}

/* ------------------------------------------------------------------ */
/*  Shared Zod response schemas                                        */
/* ------------------------------------------------------------------ */

export const PromptListItemSchema = z.object({
  name: z.string(),
  versions: z.array(z.number()).optional(),
  labels: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
});

export const PromptListResponseSchema = z.object({
  data: z.array(PromptListItemSchema),
  meta: z.object({
    page: z.number(),
    totalPages: z.number(),
    totalItems: z.number(),
  }).optional(),
});

/**
 * Fetch ALL prompts from Langfuse, auto-paginating if totalPages > 1.
 * Langfuse defaults to 10 per page; we request 100 per page (API max).
 */
export async function fetchAllPrompts(): Promise<z.infer<typeof PromptListItemSchema>[]> {
  const firstRaw = await langfuseFetch("/api/public/v2/prompts?limit=100&page=1");
  const first = PromptListResponseSchema.parse(firstRaw);
  const all = [...first.data];

  const totalPages = first.meta?.totalPages ?? 1;
  for (let page = 2; page <= totalPages; page++) {
    const raw = await langfuseFetch(`/api/public/v2/prompts?limit=100&page=${page}`);
    const parsed = PromptListResponseSchema.parse(raw);
    all.push(...parsed.data);
  }

  return all;
}

export const PromptDetailSchema = z.object({
  name: z.string(),
  version: z.number(),
  prompt: z.union([z.string(), z.array(z.unknown())]),
  labels: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
});

/** Extract prompt string from parsed detail (handles text + chat types) */
export function extractTemplate(parsed: z.infer<typeof PromptDetailSchema>): string {
  return typeof parsed.prompt === "string"
    ? parsed.prompt
    : JSON.stringify(parsed.prompt, null, 2);
}
