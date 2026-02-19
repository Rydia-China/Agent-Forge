import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma";
import type { ChatMessage } from "@/lib/agent/types";

/* ------------------------------------------------------------------ */
/*  User                                                               */
/* ------------------------------------------------------------------ */

const DEFAULT_USER = "default";

/** Get or auto-create a user by name. */
async function resolveUser(name?: string): Promise<string> {
  const userName = name?.trim() || DEFAULT_USER;
  const user = await prisma.user.upsert({
    where: { name: userName },
    update: {},
    create: { name: userName },
  });
  return user.id;
}

/* ------------------------------------------------------------------ */
/*  Session CRUD                                                       */
/* ------------------------------------------------------------------ */

export interface SessionSummary {
  id: string;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Get an existing session or create a new one.
 * Returns the session id and its historical messages.
 */
export async function getOrCreateSession(
  sessionId?: string,
  userName?: string,
): Promise<{ id: string; messages: ChatMessage[] }> {
  if (sessionId) {
    const existing = await prisma.chatSession.findUnique({
      where: { id: sessionId },
      include: {
        messages: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      },
    });
    if (existing) {
      return {
        id: existing.id,
        messages: existing.messages.map(dbMsgToChat),
      };
    }
  }

  const userId = await resolveUser(userName);
  const created = await prisma.chatSession.create({
    data: { userId },
  });
  return { id: created.id, messages: [] };
}

/** List sessions for a user (most recent first, metadata only). */
export async function listSessions(
  userName?: string,
): Promise<SessionSummary[]> {
  const userId = await resolveUser(userName);
  const rows = await prisma.chatSession.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  });
  return rows;
}

export interface KeyResourceSummary {
  id: string;
  mediaType: string;
  url: string | null;
  data: unknown;
  title: string | null;
}

/** Get a single session with its messages and key resources. */
export async function getSession(
  sessionId: string,
): Promise<{
  id: string;
  title: string | null;
  messages: ChatMessage[];
  keyResources: KeyResourceSummary[];
} | null> {
  const session = await prisma.chatSession.findUnique({
    where: { id: sessionId },
    include: {
      messages: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      keyResources: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!session) return null;
  return {
    id: session.id,
    title: session.title,
    messages: session.messages.map(dbMsgToChat),
    keyResources: session.keyResources.map((kr) => ({
      id: kr.id,
      mediaType: kr.mediaType,
      url: kr.url,
      data: kr.data,
      title: kr.title,
    })),
  };
}

/** Delete a session and all its messages. */
export async function deleteSession(sessionId: string): Promise<void> {
  await prisma.chatSession.delete({ where: { id: sessionId } });
}

/** Set / update session title. */
export async function updateSessionTitle(
  sessionId: string,
  title: string,
): Promise<void> {
  await prisma.chatSession.update({
    where: { id: sessionId },
    data: { title },
  });
}

/* ------------------------------------------------------------------ */
/*  Messages                                                           */
/* ------------------------------------------------------------------ */

/**
 * Persist new messages to DB in a single transaction.
 */
export async function pushMessages(
  sessionId: string,
  msgs: ChatMessage[],
): Promise<void> {
  if (msgs.length === 0) return;

  const data: Prisma.ChatMessageCreateManyInput[] = msgs.map((m) => ({
    sessionId,
    role: m.role,
    content: m.content ?? null,
    images: m.images?.length ? m.images : [],
    toolCalls: m.tool_calls ? (m.tool_calls as unknown as Prisma.InputJsonValue) : undefined,
    toolCallId: m.tool_call_id ?? null,
  }));

  await prisma.chatMessage.createMany({ data });
}

/**
 * Get all messages for a session (ordered by createdAt + id).
 * Using id as tiebreaker because createMany assigns the same createdAt
 * to all rows in a batch; CUID ids are monotonically sortable.
 */
export async function getMessages(
  sessionId: string,
): Promise<ChatMessage[]> {
  const rows = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map(dbMsgToChat);
}

/* ------------------------------------------------------------------ */
/*  DB row → ChatMessage conversion                                   */
/* ------------------------------------------------------------------ */

interface DbMessageRow {
  role: string;
  content: string | null;
  images: string[];
  toolCalls: Prisma.JsonValue;
  toolCallId: string | null;
}

function dbMsgToChat(row: DbMessageRow): ChatMessage {
  const msg: ChatMessage = {
    role: row.role as ChatMessage["role"],
    content: row.content,
  };
  if (row.images.length > 0) {
    msg.images = row.images;
  }
  if (row.toolCalls) {
    msg.tool_calls = row.toolCalls as unknown as ChatMessage["tool_calls"];
  }
  if (row.toolCallId) {
    msg.tool_call_id = row.toolCallId;
  }
  return msg;
}
