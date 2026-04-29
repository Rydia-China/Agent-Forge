import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";

const ApiKeyConfigSchema = z.object({
  name: z.string().min(1),
  key: z.string().min(1),
});

const ApiKeyConfigsSchema = z.array(ApiKeyConfigSchema);

interface BillingContext {
  apiKeyName?: string;
}

interface AgentForgeApiKey {
  name: string;
  keyHash: string;
}

export type ApiKeyAuthResult =
  | { status: "disabled"; apiKeyName?: undefined }
  | { status: "authenticated"; apiKeyName: string }
  | { status: "unauthorized"; message: string };

const billingContext = new AsyncLocalStorage<BillingContext>();

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function parseSimpleApiKeys(raw: string): AgentForgeApiKey[] {
  const parsed = ApiKeyConfigsSchema.parse(
    raw.split(",").map((entry) => {
      const [name, ...keyParts] = entry.split(":");
      return {
        name: name?.trim() ?? "",
        key: keyParts.join(":").trim(),
      };
    }),
  );
  return parsed.map((item) => ({ name: item.name, keyHash: hashKey(item.key) }));
}

function parseJsonApiKeys(raw: string): AgentForgeApiKey[] {
  const jsonValue: unknown = JSON.parse(raw);
  const parsed = ApiKeyConfigsSchema.parse(jsonValue);
  return parsed.map((item) => ({ name: item.name, keyHash: hashKey(item.key) }));
}

function getConfiguredApiKeys(): AgentForgeApiKey[] {
  const raw = process.env.AGENT_FORGE_API_KEYS?.trim();
  if (!raw) return [];
  return raw.startsWith("[") ? parseJsonApiKeys(raw) : parseSimpleApiKeys(raw);
}

function readPresentedKey(headers: Headers): string | undefined {
  const direct = headers.get("x-agent-forge-api-key")?.trim();
  if (direct) return direct;

  const authorization = headers.get("authorization")?.trim();
  if (!authorization) return undefined;

  const [scheme, ...tokenParts] = authorization.split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer") return undefined;

  const token = tokenParts.join(" ").trim();
  return token.length > 0 ? token : undefined;
}

export function authenticateAgentForgeApiKey(headers: Headers): ApiKeyAuthResult {
  const configuredKeys = getConfiguredApiKeys();
  if (configuredKeys.length === 0) return { status: "disabled" };

  const presentedKey = readPresentedKey(headers);
  if (!presentedKey) {
    return { status: "unauthorized", message: "Missing Agent Forge API key" };
  }

  const presentedHash = hashKey(presentedKey);
  const match = configuredKeys.find((item) => item.keyHash === presentedHash);
  if (!match) {
    return { status: "unauthorized", message: "Invalid Agent Forge API key" };
  }

  return { status: "authenticated", apiKeyName: match.name };
}

export function withBillingContext<T>(
  apiKeyName: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  return billingContext.run({ apiKeyName }, fn);
}

function resolveApiKeyName(): string {
  const configuredKeys = getConfiguredApiKeys();
  const apiKeyName = billingContext.getStore()?.apiKeyName;
  if (configuredKeys.length > 0 && !apiKeyName) {
    throw new Error("Agent Forge API key is required for billable FC calls");
  }
  return apiKeyName ?? "internal";
}

async function incrementUsage(
  apiKeyName: string,
  product: string,
  result: "attempt" | "success" | "failure",
  error?: string,
): Promise<void> {
  const now = new Date();
  await prisma.apiUsageCounter.upsert({
    where: { apiKeyName_product: { apiKeyName, product } },
    create: {
      apiKeyName,
      product,
      totalCount: result === "attempt" ? 1 : 0,
      successCount: result === "success" ? 1 : 0,
      failureCount: result === "failure" ? 1 : 0,
      lastError: error,
      lastUsedAt: now,
    },
    update: {
      totalCount: result === "attempt" ? { increment: 1 } : undefined,
      successCount: result === "success" ? { increment: 1 } : undefined,
      failureCount: result === "failure" ? { increment: 1 } : undefined,
      lastError: result === "failure" ? error : null,
      lastUsedAt: now,
    },
  });
}

export async function trackBillableFcCall<T>(
  product: string,
  fn: () => Promise<T>,
): Promise<T> {
  const apiKeyName = resolveApiKeyName();
  await incrementUsage(apiKeyName, product, "attempt");

  try {
    const result = await fn();
    await incrementUsage(apiKeyName, product, "success");
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await incrementUsage(apiKeyName, product, "failure", message);
    throw err;
  }
}
