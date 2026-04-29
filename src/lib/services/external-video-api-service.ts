import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";

const ExternalVideoApiKeyConfigSchema = z.object({
  name: z.string().min(1),
  key: z.string().min(1),
});

const ExternalVideoApiKeyConfigsSchema = z.array(ExternalVideoApiKeyConfigSchema);

export type ExternalVideoApiAuthResult =
  | { status: "authenticated"; apiKeyName: string }
  | { status: "not_configured"; message: string }
  | { status: "unauthorized"; message: string };

interface ExternalVideoApiKey {
  name: string;
  keyHash: string;
}

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function parseSimpleKeys(raw: string): ExternalVideoApiKey[] {
  const parsed = ExternalVideoApiKeyConfigsSchema.parse(
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

function parseJsonKeys(raw: string): ExternalVideoApiKey[] {
  const jsonValue: unknown = JSON.parse(raw);
  const parsed = ExternalVideoApiKeyConfigsSchema.parse(jsonValue);
  return parsed.map((item) => ({ name: item.name, keyHash: hashKey(item.key) }));
}

function getConfiguredKeys(): ExternalVideoApiKey[] {
  const raw = process.env.EXTERNAL_VIDEO_API_KEYS?.trim();
  if (!raw) return [];
  return raw.startsWith("[") ? parseJsonKeys(raw) : parseSimpleKeys(raw);
}

function readPresentedKey(headers: Headers): string | undefined {
  const direct = headers.get("x-video-api-key")?.trim();
  if (direct) return direct;

  const authorization = headers.get("authorization")?.trim();
  if (!authorization) return undefined;

  const [scheme, ...tokenParts] = authorization.split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer") return undefined;

  const token = tokenParts.join(" ").trim();
  return token.length > 0 ? token : undefined;
}

export function authenticateExternalVideoApiKey(
  headers: Headers,
): ExternalVideoApiAuthResult {
  const configuredKeys = getConfiguredKeys();
  if (configuredKeys.length === 0) {
    return {
      status: "not_configured",
      message: "EXTERNAL_VIDEO_API_KEYS is not configured",
    };
  }

  const presentedKey = readPresentedKey(headers);
  if (!presentedKey) {
    return { status: "unauthorized", message: "Missing video API key" };
  }

  const presentedHash = hashKey(presentedKey);
  const match = configuredKeys.find((item) => item.keyHash === presentedHash);
  if (!match) {
    return { status: "unauthorized", message: "Invalid video API key" };
  }

  return { status: "authenticated", apiKeyName: match.name };
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

export async function trackExternalVideoApiCall<T>(
  apiKeyName: string,
  product: string,
  fn: () => Promise<T>,
): Promise<T> {
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
