import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma";
import type { Prisma as PrismaTypes } from "@/generated/prisma";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface KeyResourceInput {
  mediaType: "image" | "video" | "json";
  url?: string;
  data?: PrismaTypes.InputJsonValue;
  title?: string;
}

export interface KeyResourceUpdateInput {
  data: PrismaTypes.InputJsonValue;
  title?: string;
}

export interface KeyResourceRow {
  id: string;
  mediaType: string;
  url: string | null;
  data: PrismaTypes.JsonValue;
  title: string | null;
  createdAt: Date;
}

/* ------------------------------------------------------------------ */
/*  Service                                                            */
/* ------------------------------------------------------------------ */

/**
 * Persist a key resource for a session.
 * Called by the agent layer when the present side-channel is detected.
 */
export async function addKeyResource(
  sessionId: string,
  input: KeyResourceInput,
): Promise<KeyResourceRow> {
  return prisma.keyResource.create({
    data: {
      sessionId,
      mediaType: input.mediaType,
      url: input.url ?? null,
      data: input.data ?? Prisma.DbNull,
      title: input.title ?? null,
    },
  });
}

/**
 * List all key resources for a session (oldest first).
 */
export async function listKeyResources(
  sessionId: string,
): Promise<KeyResourceRow[]> {
  return prisma.keyResource.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Update the data (and optionally title) of a key resource.
 * Used for user-editable JSON resources.
 */
export async function updateKeyResource(
  id: string,
  input: KeyResourceUpdateInput,
): Promise<KeyResourceRow> {
  return prisma.keyResource.update({
    where: { id },
    data: {
      data: input.data,
      ...(input.title !== undefined ? { title: input.title } : {}),
    },
  });
}

/**
 * Delete a key resource.
 */
export async function deleteKeyResource(id: string): Promise<void> {
  await prisma.keyResource.delete({ where: { id } });
}
