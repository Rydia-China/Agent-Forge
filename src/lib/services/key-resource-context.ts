import { listByScope } from "./key-resource-service";

/**
 * Build the "Resource Registry" context block for LLM injection.
 *
 * Returns a markdown section listing all tracked resources (images,
 * videos, JSON) with their current state. Returns empty string
 * if no resources are tracked.
 *
 * This is a generic utility — any ContextProvider can call it.
 */
export async function buildResourceRegistryContext(
  scopeType: string,
  scopeId: string,
): Promise<string> {
  const resources = await listByScope(scopeType, scopeId);
  if (resources.length === 0) return "";

  const lines = ["## Resource Registry"];
  for (const r of resources) {
    const promptSnippet = r.prompt ? `"${r.prompt}"` : "";
    const url = r.url ?? "none";
    const parts = [`${r.key} [${r.mediaType}]`];
    if (r.title) parts.push(`title="${r.title}"`);
    if (promptSnippet) parts.push(`prompt=${promptSnippet}`);
    if (r.mediaType !== "json") parts.push(`url=${url}`);
    parts.push(`v=${r.currentVersion}`);
    lines.push(`- ${parts.join(" ")}`);
  }
  return lines.join("\n");
}
