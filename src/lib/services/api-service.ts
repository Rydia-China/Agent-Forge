import { z } from "zod";
import { prisma } from "@/lib/db";
import type { Api, ApiVersion, Prisma } from "@/generated/prisma";
import { bizPool } from "@/lib/biz-db";
import { guardQuery, guardExecute } from "@/lib/sql-guard";
import { getCurrentUserName } from "@/lib/request-context";
import { rewriteSqlWithResolve } from "@/lib/biz-db-namespace";

/* ------------------------------------------------------------------ */
/*  Zod schemas — single source of truth for input validation         */
/* ------------------------------------------------------------------ */

/** A single operation definition inside ApiVersion.operations */
const OperationDef = z.object({
  name: z.string().min(1),
  description: z.string(),
  type: z.enum(["query", "execute"]),
  sql: z.string().min(1),
  params: z.array(z.string()),
  input: z.record(z.string(),
    z.object({
      type: z.string(),
      required: z.boolean().optional(),
      description: z.string().optional(),
    }),
  ),
});

export type OperationDef = z.infer<typeof OperationDef>;

export const ApiCreateParams = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  schema: z.record(z.string(), z.unknown()),
  operations: z.array(OperationDef).min(1),
  enabled: z.boolean().optional().default(true),
});

export const ApiUpdateParams = z.object({
  name: z.string().min(1),
  schema: z.record(z.string(), z.unknown()),
  operations: z.array(OperationDef).min(1),
  description: z.string().optional(),
  promote: z.boolean().optional().default(true),
});

export const ApiNameParams = z.object({
  name: z.string().min(1),
});

export const ApiToggleParams = z.object({
  name: z.string().min(1),
  enabled: z.boolean(),
});

export const ApiSetProductionParams = z.object({
  name: z.string().min(1),
  version: z.number().int().positive(),
});

export const ApiVersionParams = z.object({
  name: z.string().min(1),
  version: z.number().int().positive(),
});

export const ApiCallParams = z.object({
  api_name: z.string().min(1),
  operation: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional().default({}),
});

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface ApiSummary {
  name: string;
  description: string;
  enabled: boolean;
  productionVersion: number;
}

export interface ApiDetail {
  name: string;
  description: string;
  enabled: boolean;
  schema: Prisma.JsonValue;
  operations: OperationDef[];
  version: number;
  productionVersion: number;
}

export interface ApiMutationResult {
  record: Api;
  version: ApiVersion;
}

export interface ApiVersionSummary {
  version: number;
  description: string | null;
  isProduction: boolean;
  createdAt: Date;
}

export interface ApiCallResult {
  rows?: Record<string, unknown>[];
  rowCount: number | null;
  command: string;
}

/* ------------------------------------------------------------------ */
/*  Service functions                                                 */
/* ------------------------------------------------------------------ */

export async function listApis(): Promise<ApiSummary[]> {
  const apis = await prisma.api.findMany({
    orderBy: { name: "asc" },
  });
  return apis.map((a) => ({
    name: a.name,
    description: a.description,
    enabled: a.enabled,
    productionVersion: a.productionVersion,
  }));
}

export async function getApi(name: string): Promise<ApiDetail | null> {
  const api = await prisma.api.findUnique({ where: { name } });
  if (!api) return null;

  const ver = await prisma.apiVersion.findUnique({
    where: { apiId_version: { apiId: api.id, version: api.productionVersion } },
  });
  if (!ver) return null;

  return {
    name: api.name,
    description: api.description,
    enabled: api.enabled,
    schema: ver.schema,
    operations: ver.operations as unknown as OperationDef[],
    version: ver.version,
    productionVersion: api.productionVersion,
  };
}

export async function createApi(
  params: z.infer<typeof ApiCreateParams>,
): Promise<ApiMutationResult> {
  const record = await prisma.api.create({
    data: {
      name: params.name,
      description: params.description,
      enabled: params.enabled,
      productionVersion: 1,
      versions: {
        create: {
          version: 1,
          description: params.description,
          schema: params.schema as Prisma.InputJsonValue,
          operations: params.operations as unknown as Prisma.InputJsonValue,
        },
      },
    },
    include: { versions: true },
  });
  return { record, version: record.versions[0]! };
}

export async function updateApi(
  params: z.infer<typeof ApiUpdateParams>,
): Promise<ApiMutationResult> {
  const found = await prisma.api.findUnique({
    where: { name: params.name },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });
  if (!found) throw new Error(`API "${params.name}" not found`);

  const nextVersion = (found.versions[0]?.version ?? 0) + 1;

  const newVer = await prisma.apiVersion.create({
    data: {
      apiId: found.id,
      version: nextVersion,
      description: params.description ?? null,
      schema: params.schema as Prisma.InputJsonValue,
      operations: params.operations as unknown as Prisma.InputJsonValue,
    },
  });

  let record: Api = found;
  if (params.promote) {
    record = await prisma.api.update({
      where: { id: found.id },
      data: {
        productionVersion: nextVersion,
        ...(params.description !== undefined ? { description: params.description } : {}),
      },
    });
  } else if (params.description !== undefined) {
    record = await prisma.api.update({
      where: { id: found.id },
      data: { description: params.description },
    });
  }

  return { record, version: newVer };
}

export async function deleteApi(name: string): Promise<void> {
  await prisma.api.delete({ where: { name } });
}

export async function toggleApi(
  params: z.infer<typeof ApiToggleParams>,
): Promise<Api> {
  return prisma.api.update({
    where: { name: params.name },
    data: { enabled: params.enabled },
  });
}

/* ------------------------------------------------------------------ */
/*  Version management                                                */
/* ------------------------------------------------------------------ */

export async function listApiVersions(name: string): Promise<ApiVersionSummary[]> {
  const api = await prisma.api.findUnique({ where: { name } });
  if (!api) throw new Error(`API "${name}" not found`);

  const versions = await prisma.apiVersion.findMany({
    where: { apiId: api.id },
    orderBy: { version: "desc" },
    select: { version: true, description: true, createdAt: true },
  });

  return versions.map((v) => ({
    version: v.version,
    description: v.description,
    isProduction: v.version === api.productionVersion,
    createdAt: v.createdAt,
  }));
}

export async function getApiVersion(name: string, version: number): Promise<ApiDetail | null> {
  const api = await prisma.api.findUnique({ where: { name } });
  if (!api) return null;

  const ver = await prisma.apiVersion.findUnique({
    where: { apiId_version: { apiId: api.id, version } },
  });
  if (!ver) return null;

  return {
    name: api.name,
    description: api.description,
    enabled: api.enabled,
    schema: ver.schema,
    operations: ver.operations as unknown as OperationDef[],
    version: ver.version,
    productionVersion: api.productionVersion,
  };
}

export async function setApiProduction(name: string, version: number): Promise<Api> {
  const api = await prisma.api.findUnique({ where: { name } });
  if (!api) throw new Error(`API "${name}" not found`);

  const ver = await prisma.apiVersion.findUnique({
    where: { apiId_version: { apiId: api.id, version } },
  });
  if (!ver) throw new Error(`API "${name}" has no version ${version}`);

  return prisma.api.update({
    where: { id: api.id },
    data: { productionVersion: version },
  });
}

/* ------------------------------------------------------------------ */
/*  Operation execution                                               */
/* ------------------------------------------------------------------ */

export async function getApiOperations(name: string): Promise<{ schema: Prisma.JsonValue; operations: OperationDef[] } | null> {
  const detail = await getApi(name);
  if (!detail) return null;
  return { schema: detail.schema, operations: detail.operations };
}

export async function callApiOperation(
  apiName: string,
  operationName: string,
  params: Record<string, unknown>,
): Promise<ApiCallResult> {
  const api = await prisma.api.findUnique({ where: { name: apiName } });
  if (!api) throw new Error(`API "${apiName}" not found`);
  if (!api.enabled) throw new Error(`API "${apiName}" is disabled`);

  const ver = await prisma.apiVersion.findUnique({
    where: { apiId_version: { apiId: api.id, version: api.productionVersion } },
  });
  if (!ver) throw new Error(`API "${apiName}" has no production version`);

  const operations = ver.operations as unknown as OperationDef[];
  const op = operations.find((o) => o.name === operationName);
  if (!op) {
    const available = operations.map((o) => o.name).join(", ");
    throw new Error(`Operation "${operationName}" not found in API "${apiName}". Available: ${available}`);
  }

  // Validate required params
  for (const [key, def] of Object.entries(op.input)) {
    if (def.required && (params[key] === undefined || params[key] === null)) {
      throw new Error(`Missing required parameter: ${key}`);
    }
  }

  // Build parameterized values in order
  const paramValues = op.params.map((p) => params[p] ?? null);

  // SQL guard check
  if (op.type === "query") {
    const check = guardQuery(op.sql);
    if (!check.ok) throw new Error(check.reason);
  } else {
    const check = guardExecute(op.sql);
    if (!check.ok) throw new Error(check.reason);
  }

  // Rewrite logical table names → physical UUIDs via mapping table
  const autoCreate = op.type === "execute";
  const finalSql = await rewriteSqlWithResolve(getCurrentUserName(), op.sql, autoCreate);
  const result = await bizPool.query(finalSql, paramValues);

  if (op.type === "query") {
    return {
      rows: result.rows as Record<string, unknown>[],
      rowCount: result.rowCount,
      command: result.command,
    };
  }

  return {
    rowCount: result.rowCount,
    command: result.command,
  };
}
