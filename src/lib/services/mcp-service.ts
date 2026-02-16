import { z } from "zod";
import { prisma } from "@/lib/db";
import type { Prisma, McpServer, McpServerVersion } from "@/generated/prisma";
import { sandboxManager } from "@/lib/mcp/sandbox";
import { registry } from "@/lib/mcp/registry";
import { getCatalogEntries, isCatalogEntry } from "@/lib/mcp/catalog";

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
  code: z.string().min(1),
  description: z.string().nullish(),
  promote: z.boolean().optional().default(true),
});

export const McpNameParams = z.object({
  name: z.string().min(1),
});

export const McpToggleParams = z.object({
  name: z.string().min(1),
  enabled: z.boolean(),
});

export const McpSetProductionParams = z.object({
  name: z.string().min(1),
  version: z.number().int().positive(),
});

export const McpVersionParams = z.object({
  name: z.string().min(1),
  version: z.number().int().positive(),
});

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface McpSummary {
  name: string;
  description: string | null;
  enabled: boolean;
  productionVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface McpMutationResult {
  record: McpServer;
  version: McpServerVersion;
  loadError?: string;
}

export interface McpDetail {
  name: string;
  description: string | null;
  code: string;
  enabled: boolean;
  config: Prisma.JsonValue | null;
  version: number;
  productionVersion: number;
}

export interface McpVersionSummary {
  version: number;
  description: string | null;
  isProduction: boolean;
  createdAt: Date;
}

/* ------------------------------------------------------------------ */
/*  Static (built-in) MCP providers                                   */
/* ------------------------------------------------------------------ */

export interface StaticMcpSummary {
  name: string;
  available: boolean;
  active: boolean;
}

/** Core MCPs — always registered, cannot be unloaded. */
const CORE_MCPS: readonly string[] = ["skills", "mcp_manager"];

/**
 * Return all built-in MCPs (core + catalog) with availability and
 * active (loaded in registry) status.
 */
export function listStaticMcpProviders(): StaticMcpSummary[] {
  const core: StaticMcpSummary[] = CORE_MCPS.map((name) => ({
    name,
    available: true,
    active: true, // core MCPs are always active
  }));
  const catalog: StaticMcpSummary[] = getCatalogEntries().map((e) => ({
    name: e.name,
    available: e.available,
    active: !!registry.getProvider(e.name),
  }));
  return [...core, ...catalog];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/** Resolve production version code for sandbox loading. */
async function resolveProductionCode(mcpServer: McpServer): Promise<string | null> {
  const ver = await prisma.mcpServerVersion.findUnique({
    where: {
      mcpServerId_version: {
        mcpServerId: mcpServer.id,
        version: mcpServer.productionVersion,
      },
    },
  });
  return ver?.code ?? null;
}

/** Load production version into sandbox + registry. Returns loadError if any. */
async function loadProductionToSandbox(mcpServer: McpServer): Promise<string | undefined> {
  const code = await resolveProductionCode(mcpServer);
  if (!code) return `No code found for production version ${mcpServer.productionVersion}`;

  try {
    const provider = await sandboxManager.load(mcpServer.name, code);
    registry.replace(provider);
    return undefined;
  } catch (err: unknown) {
    return err instanceof Error ? err.message : String(err);
  }
}

/* ------------------------------------------------------------------ */
/*  Service functions                                                 */
/* ------------------------------------------------------------------ */

export async function listMcpServers(): Promise<McpSummary[]> {
  const servers = await prisma.mcpServer.findMany({
    include: { versions: { orderBy: { version: "desc" as const }, take: 1 } },
    orderBy: { name: "asc" },
  });

  return servers.map((s) => {
    const prodVer = s.versions.find((v) => v.version === s.productionVersion) ?? s.versions[0];
    return {
      name: s.name,
      description: prodVer?.description ?? null,
      enabled: s.enabled,
      productionVersion: s.productionVersion,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  });
}

export async function getMcpServer(name: string): Promise<McpDetail | null> {
  // Resolve built-in (core / catalog) MCPs first
  if (CORE_MCPS.includes(name) || isCatalogEntry(name)) {
    return {
      name,
      description: "Built-in MCP provider",
      code: "",
      enabled: true,
      config: null,
      version: 0,
      productionVersion: 0,
    };
  }

  const server = await prisma.mcpServer.findUnique({ where: { name } });
  if (!server) return null;

  const ver = await prisma.mcpServerVersion.findUnique({
    where: {
      mcpServerId_version: {
        mcpServerId: server.id,
        version: server.productionVersion,
      },
    },
  });
  if (!ver) return null;

  return {
    name: server.name,
    description: ver.description,
    code: ver.code,
    enabled: server.enabled,
    config: server.config,
    version: ver.version,
    productionVersion: server.productionVersion,
  };
}

export async function getMcpCode(name: string): Promise<string | null> {
  const server = await prisma.mcpServer.findUnique({ where: { name } });
  if (!server) return null;

  const ver = await prisma.mcpServerVersion.findUnique({
    where: {
      mcpServerId_version: {
        mcpServerId: server.id,
        version: server.productionVersion,
      },
    },
  });
  return ver?.code ?? null;
}

export async function createMcpServer(
  params: z.infer<typeof McpCreateParams>,
): Promise<McpMutationResult> {
  const record = await prisma.mcpServer.create({
    data: {
      name: params.name,
      enabled: params.enabled,
      productionVersion: 1,
      versions: {
        create: {
          version: 1,
          description: params.description ?? null,
          code: params.code,
        },
      },
    },
    include: { versions: true },
  });

  const version = record.versions[0]!;
  let loadError: string | undefined;
  if (record.enabled) {
    loadError = await loadProductionToSandbox(record);
  }
  return { record, version, loadError };
}

/** Push a new version. Defaults to auto-promote + reload. */
export async function updateMcpServer(
  params: z.infer<typeof McpUpdateParams>,
): Promise<McpMutationResult> {
  const found = await prisma.mcpServer.findUnique({
    where: { name: params.name },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });
  if (!found) throw new Error(`MCP server "${params.name}" not found`);

  const nextVersion = (found.versions[0]?.version ?? 0) + 1;

  const newVer = await prisma.mcpServerVersion.create({
    data: {
      mcpServerId: found.id,
      version: nextVersion,
      description: params.description ?? null,
      code: params.code,
    },
  });

  let record: McpServer = found;
  let loadError: string | undefined;

  if (params.promote) {
    record = await prisma.mcpServer.update({
      where: { id: found.id },
      data: { productionVersion: nextVersion },
    });
    if (record.enabled) {
      loadError = await loadProductionToSandbox(record);
    }
  }

  return { record, version: newVer, loadError };
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
  } else {
    // Enabling: load production version
    await loadProductionToSandbox(record);
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

  const loadError = await loadProductionToSandbox(record);
  if (loadError) throw new Error(loadError);
  return `Reloaded MCP server "${record.name}" (production v${record.productionVersion})`;
}

/* ------------------------------------------------------------------ */
/*  Version management                                                */
/* ------------------------------------------------------------------ */

export async function listMcpServerVersions(name: string): Promise<McpVersionSummary[]> {
  const server = await prisma.mcpServer.findUnique({ where: { name } });
  if (!server) return []; // builtins have no DB versions

  const versions = await prisma.mcpServerVersion.findMany({
    where: { mcpServerId: server.id },
    orderBy: { version: "desc" },
    select: { version: true, description: true, createdAt: true },
  });

  return versions.map((v) => ({
    version: v.version,
    description: v.description,
    isProduction: v.version === server.productionVersion,
    createdAt: v.createdAt,
  }));
}

export async function getMcpServerVersion(name: string, version: number): Promise<McpDetail | null> {
  const server = await prisma.mcpServer.findUnique({ where: { name } });
  if (!server) return null;

  const ver = await prisma.mcpServerVersion.findUnique({
    where: { mcpServerId_version: { mcpServerId: server.id, version } },
  });
  if (!ver) return null;

  return {
    name: server.name,
    description: ver.description,
    code: ver.code,
    enabled: server.enabled,
    config: server.config,
    version: ver.version,
    productionVersion: server.productionVersion,
  };
}

export async function setMcpProduction(name: string, version: number): Promise<{ record: McpServer; loadError?: string }> {
  const server = await prisma.mcpServer.findUnique({ where: { name } });
  if (!server) throw new Error(`MCP server "${name}" not found`);

  const ver = await prisma.mcpServerVersion.findUnique({
    where: { mcpServerId_version: { mcpServerId: server.id, version } },
  });
  if (!ver) throw new Error(`MCP server "${name}" has no version ${version}`);

  const record = await prisma.mcpServer.update({
    where: { id: server.id },
    data: { productionVersion: version },
  });

  let loadError: string | undefined;
  if (record.enabled) {
    loadError = await loadProductionToSandbox(record);
  }
  return { record, loadError };
}
