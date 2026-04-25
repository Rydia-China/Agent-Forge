import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatMessage as OpenAIChatMessage } from '@/lib/agent/types';

const prismaMock = {
  chatSession: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  chatMessage: {
    findMany: vi.fn(),
    createMany: vi.fn(),
  },
  user: {
    upsert: vi.fn(),
  },
};

vi.mock('@/lib/db', () => ({
  prisma: prismaMock,
}));

describe('chat-session-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('stripDanglingToolCalls', () => {
    it('should remove tool_calls with no matching tool response', async () => {
      const { stripDanglingToolCalls } = await import('./chat-session-service');

      const messages: OpenAIChatMessage[] = [
        {
          role: 'user',
          content: 'Hello',
        },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'tool_1', arguments: '{}' } },
            { id: 'call_2', type: 'function', function: { name: 'tool_2', arguments: '{}' } },
          ],
        },
        {
          role: 'tool',
          content: 'Result 1',
          tool_call_id: 'call_1',
        },
      ];

      stripDanglingToolCalls(messages);

      const assistantMsg = messages.find((m) => m.role === 'assistant');
      expect(assistantMsg).toBeDefined();
      expect(assistantMsg!.tool_calls).toHaveLength(1);
      expect(assistantMsg!.tool_calls![0].id).toBe('call_1');
    });

    it('should remove all tool_calls if none have responses', async () => {
      const { stripDanglingToolCalls } = await import('./chat-session-service');

      const messages: OpenAIChatMessage[] = [
        {
          role: 'user',
          content: 'Hello',
        },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'tool_1', arguments: '{}' } },
            { id: 'call_2', type: 'function', function: { name: 'tool_2', arguments: '{}' } },
          ],
        },
      ];

      stripDanglingToolCalls(messages);

      const assistantMsg = messages.find((m) => m.role === 'assistant');
      expect(assistantMsg).toBeDefined();
      expect(assistantMsg!.tool_calls).toBeUndefined();
    });

    it('should keep all tool_calls if all have responses', async () => {
      const { stripDanglingToolCalls } = await import('./chat-session-service');

      const messages: OpenAIChatMessage[] = [
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'tool_1', arguments: '{}' } },
            { id: 'call_2', type: 'function', function: { name: 'tool_2', arguments: '{}' } },
          ],
        },
        {
          role: 'tool',
          content: 'Result 1',
          tool_call_id: 'call_1',
        },
        {
          role: 'tool',
          content: 'Result 2',
          tool_call_id: 'call_2',
        },
      ];

      stripDanglingToolCalls(messages);

      const assistantMsg = messages.find((m) => m.role === 'assistant');
      expect(assistantMsg).toBeDefined();
      expect(assistantMsg!.tool_calls).toHaveLength(2);
    });

    it('should not modify messages without tool_calls', async () => {
      const { stripDanglingToolCalls } = await import('./chat-session-service');

      const messages: OpenAIChatMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ];

      stripDanglingToolCalls(messages);

      expect(messages).toHaveLength(2);
      expect(messages[0].content).toBe('Hello');
      expect(messages[1].content).toBe('Hi there');
    });
  });

  describe('pushMessages', () => {
    it('should persist messages in a single transaction', async () => {
      const { pushMessages } = await import('./chat-session-service');

      const messages: OpenAIChatMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
      ];

      prismaMock.chatMessage.createMany.mockResolvedValue({ count: 2 });

      await pushMessages('session_123', messages);

      expect(prismaMock.chatMessage.createMany).toHaveBeenCalledTimes(1);
      expect(prismaMock.chatMessage.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            sessionId: 'session_123',
            role: 'user',
            content: 'Hello',
          }),
          expect.objectContaining({
            sessionId: 'session_123',
            role: 'assistant',
            content: 'Hi',
          }),
        ]),
      });
    });

    it('should handle empty message array', async () => {
      const { pushMessages } = await import('./chat-session-service');

      await pushMessages('session_123', []);

      expect(prismaMock.chatMessage.createMany).not.toHaveBeenCalled();
    });
  });

  describe('getOrCreateSession', () => {
    it('should return existing session with messages', async () => {
      const { getOrCreateSession } = await import('./chat-session-service');

      const mockSession = {
        id: 'session_123',
        userId: 'user_123',
        title: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        messages: [
          {
            id: 'msg_1',
            sessionId: 'session_123',
            role: 'user',
            content: 'Hello',
            images: [],
            toolCalls: null,
            toolCallId: null,
            hidden: false,
            createdAt: new Date(),
          },
        ],
      };

      prismaMock.chatSession.findUnique.mockResolvedValue(mockSession as never);

      const result = await getOrCreateSession('session_123');

      expect(result.id).toBe('session_123');
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe('Hello');
    });

    it('should create new session if not found', async () => {
      const { getOrCreateSession } = await import('./chat-session-service');

      prismaMock.chatSession.findUnique.mockResolvedValue(null);
      prismaMock.user.upsert.mockResolvedValue({
        id: 'user_123',
        name: 'default',
      } as never);
      prismaMock.chatSession.create.mockResolvedValue({
        id: 'session_new',
        userId: 'user_123',
        title: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);

      const result = await getOrCreateSession('session_nonexistent');

      expect(result.id).toBe('session_new');
      expect(result.messages).toHaveLength(0);
    });
  });
});
