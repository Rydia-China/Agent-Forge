import { buildResourceRegistryContext } from "@/lib/services/key-resource-context";
import { listByScope } from "@/lib/services/key-resource-service";
import type { Prisma } from "@/generated/prisma";

/**
 * ContextProvider — generic interface for dynamic context injection.
 *
 * Before each LLM call, `build()` is called to get the latest system state.
 * The result is injected as a user-role message in the context pair:
 *   assistant: "What is the current system state?"
 *   user: <ContextProvider.build() output>
 */
export interface ContextProvider {
  /** Build the current system state string. Called every LLM iteration. */
  build(): Promise<string>;
}

export interface ScopeInfo {
  scopeType: string;
  scopeId: string;
}

/**
 * Base ContextProvider — provides key resource state (JSON + registry).
 * Used as the default when no domain-specific provider is configured.
 * Domain providers (e.g. VideoContextProvider) should extend this.
 */
export class BaseContextProvider implements ContextProvider {
  constructor(protected readonly scope?: ScopeInfo) {}

  protected getScope(): ScopeInfo | undefined {
    return this.scope;
  }

  async build(): Promise<string> {
    const scope = this.getScope();
    if (!scope) return "";

    const parts: string[] = [];

    // Key JSON resources
    const keyJsonCtx = await this.buildKeyJsonContext(scope);
    if (keyJsonCtx) parts.push(keyJsonCtx);

    // Resource registry (images, videos, etc.)
    const registryCtx = await buildResourceRegistryContext(scope.scopeType, scope.scopeId);
    if (registryCtx) parts.push(registryCtx);

    return parts.join("\n\n");
  }

  protected async buildKeyJsonContext(scope: ScopeInfo): Promise<string | null> {
    const resources = await listByScope(scope.scopeType, scope.scopeId);
    const jsonResources = resources.filter(
      (r) => r.mediaType === "json" && r.data != null,
    );
    if (jsonResources.length === 0) return null;

    const items = jsonResources.map((r) => {
      const label = r.title ?? r.key;
      const json =
        typeof r.data === "string"
          ? r.data
          : JSON.stringify(r.data as Prisma.JsonValue, null, 2);
      return `## ${label}\n\`\`\`json\n${json}\n\`\`\``;
    });
    return `# Key Data (latest)\n\n${items.join("\n\n")}`;
  }
}
