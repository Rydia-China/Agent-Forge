import type { ChatSession, ChatMessage } from "./types.js";

class SessionStore {
  private sessions = new Map<string, ChatSession>();

  create(id?: string): ChatSession {
    const session: ChatSession = {
      id: id ?? crypto.randomUUID(),
      messages: [],
      createdAt: new Date(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): ChatSession | undefined {
    return this.sessions.get(id);
  }

  getOrCreate(id?: string): ChatSession {
    if (id) {
      const existing = this.sessions.get(id);
      if (existing) return existing;
    }
    return this.create(id);
  }

  push(sessionId: string, ...msgs: ChatMessage[]): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session "${sessionId}" not found`);
    session.messages.push(...msgs);
  }

  delete(id: string): void {
    this.sessions.delete(id);
  }
}

const g = globalThis as unknown as { __sessionStore?: SessionStore };
export const sessionStore = g.__sessionStore ?? new SessionStore();
g.__sessionStore = sessionStore;
