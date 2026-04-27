import type { ToolContext } from "@/lib/mcp/types";
import type { SubAgentResult } from "@/lib/agent/subagent";
import { resolveModel } from "@/lib/agent/models";
import type { TaskInput } from "./subagent-task-service";

/* ================================================================== */
/*  Types                                                              */
/* ================================================================== */

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

/* ================================================================== */
/*  JSON helpers                                                       */
/* ================================================================== */

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (typeof value === "object") {
    return Object.values(value).every(isJsonValue);
  }
  return false;
}

function isJsonObject(value: unknown): value is JsonObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    isJsonValue(value)
  );
}

function normalizeJsonObject(value: unknown): JsonObject {
  const normalized: unknown = JSON.parse(JSON.stringify(value));
  return isJsonObject(normalized) ? normalized : {};
}

/* ================================================================== */
/*  Database helpers                                                   */
/* ================================================================== */

async function getPrisma() {
  const db = await import("@/lib/db");
  return db.prisma;
}

async function getSessionResolver() {
  const service = await import("@/lib/services/chat-session-service");
  return service.getOrCreateSession;
}

function dbStatusFromResult(status: SubAgentResult["status"]): string {
  return status;
}

function formatResultForDb(
  result: SubAgentResult & { agentId: string },
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    status: result.status === "completed" ? "ok" : result.status,
    result: result.output,
    agentId: result.agentId,
    model: result.model,
    durationMs: result.durationMs,
    toolCallCount: result.toolCallCount,
  };
  if (result.error) base.error = result.error;
  if (result.validated !== undefined) base.validated = result.validated;
  if (result.attempts !== undefined) base.attempts = result.attempts;
  if (result.keyJsonTitle) base.keyJsonTitle = result.keyJsonTitle;
  base.trace = result.trace;
  return base;
}

/* ================================================================== */
/*  Persistence operations                                             */
/* ================================================================== */

/**
 * Create an async task record in the database.
 * Returns the task ID.
 */
export async function createAsyncRecord(
  task: TaskInput,
  context?: ToolContext,
): Promise<string> {
  const getOrCreateSession = await getSessionResolver();
  const prisma = await getPrisma();
  const session = await getOrCreateSession(
    context?.sessionId,
    context?.userName,
  );
  const row = await prisma.subAgent.create({
    data: {
      sessionId: session.id,
      depth: context?.agentDepth ?? 0,
      status: "pending",
      config: normalizeJsonObject({ source: "mcp.subagent", task }),
    },
    select: { id: true },
  });
  return row.id;
}

/**
 * Persist a successful or failed subagent result to the database.
 */
export async function persistResult(
  taskId: string,
  result: SubAgentResult & { agentId: string },
): Promise<void> {
  const prisma = await getPrisma();
  await prisma.subAgent.update({
    where: { id: taskId },
    data: {
      status: dbStatusFromResult(result.status),
      output: result.output || null,
      error: result.error ?? null,
      trace: normalizeJsonObject(formatResultForDb(result)),
    },
  });
}

/**
 * Persist a failure (e.g., exception during execution) to the database.
 */
export async function persistFailure(
  taskId: string,
  error: string,
  model: string,
  durationMs: number,
): Promise<void> {
  const prisma = await getPrisma();
  await prisma.subAgent.update({
    where: { id: taskId },
    data: {
      status: "failed",
      output: null,
      error,
      trace: normalizeJsonObject({
        status: "failed",
        result: "",
        error,
        model,
        durationMs,
        toolCallCount: 0,
      }),
    },
  });
}

/**
 * Update task status to "running".
 */
export async function markTaskRunning(taskId: string): Promise<void> {
  const prisma = await getPrisma();
  await prisma.subAgent.update({
    where: { id: taskId },
    data: { status: "running" },
  });
}
