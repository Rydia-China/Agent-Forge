import { z } from "zod";
import {
  langfuseFetch,
  compileTemplate,
  extractTemplate,
  fetchAllPrompts,
  PromptDetailSchema,
  PromptListItemSchema,
} from "@/lib/mcp/static/langfuse-helpers";

/* ------------------------------------------------------------------ */
/*  Public types                                                       */
/* ------------------------------------------------------------------ */

export type PromptListItem = z.infer<typeof PromptListItemSchema>;

export interface PromptDetail {
  name: string;
  version: number;
  template: string;
  labels: string[];
  tags: string[];
  type: "text" | "chat";
  /** Raw prompt field from Langfuse (string or chat messages array) */
  rawPrompt: string | unknown[];
}

export interface PromptCompileResult {
  name: string;
  version: number;
  compiledPrompt: string;
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */

const DetailSchema = PromptDetailSchema.extend({
  type: z.enum(["text", "chat"]).optional(),
});

function toDetail(parsed: z.infer<typeof DetailSchema>): PromptDetail {
  return {
    name: parsed.name,
    version: parsed.version,
    template: extractTemplate(parsed),
    labels: parsed.labels ?? [],
    tags: parsed.tags ?? [],
    type: (parsed.type as "text" | "chat") ?? "text",
    rawPrompt: parsed.prompt,
  };
}

/* ------------------------------------------------------------------ */
/*  Service methods                                                    */
/* ------------------------------------------------------------------ */

/** List all prompts (metadata only, no template content). */
export async function listPrompts(): Promise<PromptListItem[]> {
  return fetchAllPrompts();
}

/**
 * Get a single prompt's full detail.
 * - No version → returns the "production" labeled version (Langfuse default).
 * - With version → returns that specific version.
 */
export async function getPrompt(
  name: string,
  version?: number,
): Promise<PromptDetail> {
  const qs = version != null ? `?version=${version}` : "";
  const raw = await langfuseFetch(
    `/api/public/v2/prompts/${encodeURIComponent(name)}${qs}`,
  );
  return toDetail(DetailSchema.parse(raw));
}

/**
 * Fetch all version details for a prompt.
 * Uses the versions[] array from the list endpoint, then fetches each version.
 */
export async function getPromptVersions(
  name: string,
): Promise<PromptDetail[]> {
  const all = await fetchAllPrompts();
  const entry = all.find((p) => p.name === name);
  if (!entry) throw new Error(`Prompt not found: ${name}`);

  const versions = entry.versions ?? [];
  if (versions.length === 0) {
    // Fallback: fetch default version only
    const single = await getPrompt(name);
    return [single];
  }

  const results = await Promise.allSettled(
    versions.map((v) => getPrompt(name, v)),
  );
  return results
    .filter((r): r is PromiseFulfilledResult<PromptDetail> => r.status === "fulfilled")
    .map((r) => r.value)
    .sort((a, b) => b.version - a.version);
}

/**
 * Create a new prompt version (or a brand-new prompt if the name doesn't exist).
 * Set labels to ["production"] to deploy immediately.
 */
export async function createPromptVersion(
  name: string,
  prompt: string,
  type: "text" | "chat" = "text",
  labels?: string[],
): Promise<PromptDetail> {
  const body: Record<string, unknown> = { name, prompt, type };
  if (labels) body.labels = labels;
  const raw = await langfuseFetch("/api/public/v2/prompts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return toDetail(DetailSchema.parse(raw));
}

/**
 * Fetch a prompt and compile its template by replacing {{variable}} placeholders.
 */
export async function compilePrompt(
  name: string,
  variables: Record<string, string>,
  version?: number,
): Promise<PromptCompileResult> {
  const detail = await getPrompt(name, version);
  const compiled = compileTemplate(detail.template, variables);
  return {
    name: detail.name,
    version: detail.version,
    compiledPrompt: compiled,
  };
}
