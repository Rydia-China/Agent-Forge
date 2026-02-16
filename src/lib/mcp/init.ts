import { registry } from "./registry";
import { sandboxManager } from "./sandbox";
import { skillsMcp } from "./static/skills-mcp";
import { mcpManagerMcp } from "./static/mcp-manager";
import { bizDbMcp } from "./static/biz-db";
import { apisMcp } from "./static/apis";
import { videoMgrMcp } from "./static/video-mgr";
import { langfuseMcp } from "./static/langfuse";
import { langfuseAdminMcp } from "./static/langfuse-admin";
import { subagentMcp } from "./static/subagent";
import { prisma } from "@/lib/db";

/**
 * Register static MCP providers + load all enabled dynamic MCPs from DB.
 * Safe to call multiple times — only runs once (guarded by registry.initialized).
 */
export async function initMcp(): Promise<void> {
  if (registry.initialized) return;
  registry.initialized = true;

  // Static providers
  registry.register(skillsMcp);
  registry.register(mcpManagerMcp);
  registry.register(bizDbMcp);
  registry.register(apisMcp);
  if (process.env.FC_GENERATE_IMAGE_URL || process.env.FC_GENERATE_VIDEO_URL) {
    registry.register(videoMgrMcp);
  }
  if (process.env.LANGFUSE_BASE_URL && process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY) {
    registry.register(langfuseMcp);
    registry.register(langfuseAdminMcp);
  }
  if (process.env.LLM_API_KEY) {
    registry.register(subagentMcp);
  }

  // Dynamic providers from DB
  const records = await prisma.mcpServer.findMany({
    where: { enabled: true },
    include: { versions: true },
  });
  for (const record of records) {
    const prodVer = record.versions.find((v) => v.version === record.productionVersion);
    if (!prodVer) {
      console.error(`[initMcp] MCP "${record.name}" has no production version ${record.productionVersion}`);
      continue;
    }
    try {
      const provider = await sandboxManager.load(record.name, prodVer.code);
      registry.replace(provider);
    } catch (err) {
      console.error(`[initMcp] Failed to load dynamic MCP "${record.name}" v${prodVer.version}:`, err);
    }
  }
}
