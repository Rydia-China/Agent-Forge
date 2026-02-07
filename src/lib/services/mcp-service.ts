import { z } from "zod";
import { prisma } from "@/lib/db";
import type { Prisma, McpServer } from "@/generated/prisma";
import { sandboxManager } from "@/lib/mcp/sandbox";
import { registry } from "@/lib/mcp/registry";

/* ------------------------------------------------------------------ */
/*  Zod schemas                                                       */
/* ------------------------------------------------------------------ */

export const McpCreateParams = z.object({
  name: z.string().min(1),
  description: z.string().nullish(),
  code: z.string().min(1),
  enabled: z.boolean().optional().default(true),
});

export const McpUpdateParams = z.object({
  name: z.string().min(1),
  code: z.string().optional(),
  description: z.string().nullish(),
  enabled: z.boolean().optional(),
  config: z.unknown().optional(),
});

export const McpNameParams = z.object({
  name: z.string().min(1),
});

export const McpToggleParams = z.object({
  name: z.string().min(1),
  enabled: z.boolean(),
});

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type McpSummary = Pick<McpServer, "name" | "description" | "enabled" | "createdAt" | "updatedAt">;

export interface McpMutationResult {
  record: McpServer;
  loadError?: string;
}

/* ------------------------------------------------------------------ */
/*  Service functions                                                 */
/* ------------------------------------------------------------------ */

export async function listMcpServers(): Promise<McpSummary[]> {
  return prisma.mcpServer.findMany({
    select: { name: true, description: true, enabled: true, createdAt: true, updatedAt: true },
    orderBy: { name: "asc" },
  });
}

export async function getMcpServer(name: string): Promise<McpServer | null> {
  return prisma.mcpServer.findUnique({ where: { name } });
}

export async function getMcpCode(name: string): Promise<string | null> {
  const record = await prisma.mcpServer.findUnique({ where: { name } });
  return record?.code ?? null;
}

export async function createMcpServer(
  params: z.infer<typeof McpCreateParams>,
): Promise<McpMutationResult> {
  const data: Prisma.McpServerCreateInput = {
    name: params.name,
    description: params.description ?? null,
    code: params.code,
    enabled: params.enabled,
  };
  const record = await prisma.mcpServer.create({ data });

  let loadError: string | undefined;
  if (record.enabled) {
    try {
      const provider = await sandboxManager.load(record.name, record.code);
      registry.replace(provider);
    } catch (err: unknown) {
      loadError = err instanceof Error ? err.message : String(err);
    }
  }
  return { record, loadError };
}

export async function updateMcpServer(
  params: z.infer<typeof McpUpdateParams>,
): Promise<McpMutationResult> {
  const data: Prisma.McpServerUpdateInput = {};
  if (params.code !== undefined) data.code = params.code;
  if (params.description !== undefined) data.description = params.description;
  if (params.enabled !== undefined) data.enabled = params.enabled;
  if (params.config !== undefined) data.config = params.config as Prisma.InputJsonValue;

  const record = await prisma.mcpServer.update({
    where: { name: params.name },
    data,
  });

  let loadError: string | undefined;
  if (!record.enabled) {
    sandboxManager.unload(record.name);
    registry.unregister(record.name);
  } else if (params.code !== undefined) {
    try {
      const provider = await sandboxManager.load(record.name, record.code);
      registry.replace(provider);
    } catch (err: unknown) {
      loadError = err instanceof Error ? err.message : String(err);
    }
  }
  return { record, loadError };
}

export async function toggleMcpServer(
  params: z.infer<typeof McpToggleParams>,
): Promise<McpServer> {
  const record = await prisma.mcpServer.update({
    where: { name: params.name },
    data: { enabled: params.enabled },
  });
  if (!record.enabled) {
    sandboxManager.unload(record.name);
    registry.unregister(record.name);
  }
  return record;
}

export async function deleteMcpServer(name: string): Promise<void> {
  sandboxManager.unload(name);
  registry.unregister(name);
  await prisma.mcpServer.delete({ where: { name } });
}

export async function reloadMcpServer(name: string): Promise<string> {
  const record = await prisma.mcpServer.findUnique({ where: { name } });
  if (!record) throw new Error(`MCP server "${name}" not found in DB`);
  if (!record.enabled) throw new Error(`MCP server "${name}" is disabled. Enable it first.`);

  const provider = await sandboxManager.load(record.name, record.code);
  registry.replace(provider);
  return `Reloaded MCP server "${record.name}"`;
}
