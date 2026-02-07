import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma";
import type { ChatMessage } from "@/lib/agent/types";

/* ------------------------------------------------------------------ */
/*  Service functions                                                  */
/* ------------------------------------------------------------------ */

/**
 * Get an existing session or create a new one.
 * Returns the session id and its historical messages.
 */
export async function getOrCreateSession(
  sessionId?: string,
): Promise<{ id: string; messages: ChatMessage[] }> {
  if (sessionId) {
    const existing = await prisma.chatSession.findUnique({
      where: { id: sessionId },
      include: {
        messages: { orderBy: { createdAt: "asc" } },
      },
    });
    if (existing) {
      return {
        id: existing.id,
        messages: existing.messages.map(dbMsgToChat),
      };
    }
  }

  // Create new session (use provided id if given, otherwise auto-generate)
  const created = await prisma.chatSession.create({
    data: sessionId ? { id: sessionId } : {},
  });
  return { id: created.id, messages: [] };
}

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
    toolCalls: m.tool_calls ? (m.tool_calls as unknown as Prisma.InputJsonValue) : undefined,
    toolCallId: m.tool_call_id ?? null,
  }));

  await prisma.chatMessage.createMany({ data });
}

/**
 * Get all messages for a session (ordered by createdAt).
 */
export async function getMessages(
  sessionId: string,
): Promise<ChatMessage[]> {
  const rows = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(dbMsgToChat);
}

/* ------------------------------------------------------------------ */
/*  DB row → ChatMessage conversion                                   */
/* ------------------------------------------------------------------ */

interface DbMessageRow {
  role: string;
  content: string | null;
  toolCalls: Prisma.JsonValue;
  toolCallId: string | null;
}

function dbMsgToChat(row: DbMessageRow): ChatMessage {
  const msg: ChatMessage = {
    role: row.role as ChatMessage["role"],
    content: row.content,
  };
  if (row.toolCalls) {
    msg.tool_calls = row.toolCalls as unknown as ChatMessage["tool_calls"];
  }
  if (row.toolCallId) {
    msg.tool_call_id = row.toolCallId;
  }
  return msg;
}
