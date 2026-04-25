import { describe, it, expect, vi, beforeEach } from 'vitest'
import { stripDanglingToolCalls, pushMessages, getOrCreateSession } from './chat-session-service'
import { createMockConversationWithDanglingToolCall } from '@/../test/helpers/fixtures'
import { createPrismaMock } from '@/../test/helpers/prisma-mock'
import type { ChatMessage } from '@/lib/agent/types'

vi.mock('@/lib/db', () => ({
  prisma: createPrismaMock(),
}))

describe('chat-session-service', () => {
  let prismaMock: ReturnType<typeof createPrismaMock>

  beforeEach(async () => {
    const { prisma } = await import('@/lib/db')
    prismaMock = prisma as ReturnType<typeof createPrismaMock>
    vi.clearAllMocks()
  })

  describe('stripDanglingToolCalls', () => {
    it('should remove tool_calls with no matching tool response', () => {
      const messages: ChatMessage[] = [
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
      ]
      
      stripDanglingToolCalls(messages)
      
      const assistantMsg = messages.find(m => m.role === 'assistant')
      expect(assistantMsg?.tool_calls).toHaveLength(1)
      expect(assistantMsg?.tool_calls?.[0].id).toBe('call_1')
    })

    it('should remove all tool_calls if none have responses', () => {
      const messages: ChatMessage[] = [
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
      ]
      
      stripDanglingToolCalls(messages)
      
      const assistantMsg = messages.find(m => m.role === 'assistant')
      expect(assistantMsg).toBeDefined()
      expect(assistantMsg!.tool_calls).toBeUndefined()
    })

    it('should keep all tool_calls if all have responses', () => {
      const messages: ChatMessage[] = [
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
      ]
      
      stripDanglingToolCalls(messages)
      
      const assistantMsg = messages.find(m => m.role === 'assistant')
      expect(assistantMsg).toBeDefined()
      expect(assistantMsg!.tool_calls).toHaveLength(2)
    })

    it('should not modify messages without tool_calls', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ]
      
      stripDanglingToolCalls(messages)
      
      expect(messages).toHaveLength(2)
      expect(messages[0].content).toBe('Hello')
      expect(messages[1].content).toBe('Hi there')
    })
  })

  describe('pushMessages', () => {
    it('should persist messages in a single transaction', async () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
      ]
      
      vi.mocked(prismaMock.chatMessage.createMany).mockResolvedValue({ count: 2 })
      
      await pushMessages('session_123', messages)
      
      expect(prismaMock.chatMessage.createMany).toHaveBeenCalledTimes(1)
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
      })
    })

    it('should handle empty message array', async () => {
      await pushMessages('session_123', [])
      
      expect(prismaMock.chatMessage.createMany).not.toHaveBeenCalled()
    })

    it('should convert tool_calls to JSON', async () => {
      const messages: ChatMessage[] = [
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'test', arguments: '{}' } },
          ],
        },
      ]
      
      vi.mocked(prismaMock.chatMessage.createMany).mockResolvedValue({ count: 1 })
      
      await pushMessages('session_123', messages)
      
      expect(prismaMock.chatMessage.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            toolCalls: expect.arrayContaining([
              expect.objectContaining({ id: 'call_1' }),
            ]),
          }),
        ]),
      })
    })

    it('should handle images array', async () => {
      const messages: ChatMessage[] = [
        {
          role: 'user',
          content: 'Look at this',
          images: ['https://example.com/image.jpg'],
        },
      ]
      
      vi.mocked(prismaMock.chatMessage.createMany).mockResolvedValue({ count: 1 })
      
      await pushMessages('session_123', messages)
      
      expect(prismaMock.chatMessage.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({
            images: ['https://example.com/image.jpg'],
          }),
        ]),
      })
    })
  })

  describe('getOrCreateSession', () => {
    it('should return existing session with messages', async () => {
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
      }
      
      vi.mocked(prismaMock.chatSession.findUnique).mockResolvedValue(mockSession as never)
      
      const result = await getOrCreateSession('session_123')
      
      expect(result.id).toBe('session_123')
      expect(result.messages).toHaveLength(1)
      expect(result.messages[0].content).toBe('Hello')
      expect(prismaMock.chatSession.findUnique).toHaveBeenCalledWith({
        where: { id: 'session_123' },
        include: {
          messages: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        },
      })
    })

    it('should create new session if not found', async () => {
      vi.mocked(prismaMock.chatSession.findUnique).mockResolvedValue(null)
      vi.mocked(prismaMock.user.upsert).mockResolvedValue({
        id: 'user_123',
        name: 'default',
      } as never)
      vi.mocked(prismaMock.chatSession.create).mockResolvedValue({
        id: 'session_new',
        userId: 'user_123',
        title: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never)
      
      const result = await getOrCreateSession('session_nonexistent')
      
      expect(result.id).toBe('session_new')
      expect(result.messages).toHaveLength(0)
      expect(prismaMock.chatSession.create).toHaveBeenCalledWith({
        data: { userId: 'user_123' },
      })
    })

    it('should create new session without sessionId', async () => {
      vi.mocked(prismaMock.user.upsert).mockResolvedValue({
        id: 'user_123',
        name: 'default',
      } as never)
      vi.mocked(prismaMock.chatSession.create).mockResolvedValue({
        id: 'session_new',
        userId: 'user_123',
        title: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never)
      
      const result = await getOrCreateSession()
      
      expect(result.id).toBe('session_new')
      expect(result.messages).toHaveLength(0)
      expect(prismaMock.chatSession.findUnique).not.toHaveBeenCalled()
    })

    it('should strip dangling tool_calls from loaded messages', async () => {
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
            role: 'assistant',
            content: '',
            images: [],
            toolCalls: [
              { id: 'call_1', type: 'function', function: { name: 'tool_1', arguments: '{}' } },
              { id: 'call_2', type: 'function', function: { name: 'tool_2', arguments: '{}' } },
            ],
            toolCallId: null,
            hidden: false,
            createdAt: new Date(),
          },
          {
            id: 'msg_2',
            sessionId: 'session_123',
            role: 'tool',
            content: 'Result 1',
            images: [],
            toolCalls: null,
            toolCallId: 'call_1',
            hidden: false,
            createdAt: new Date(),
          },
        ],
      }
      
      vi.mocked(prismaMock.chatSession.findUnique).mockResolvedValue(mockSession as never)
      
      const result = await getOrCreateSession('session_123')
      
      const assistantMsg = result.messages.find(m => m.role === 'assistant')
      expect(assistantMsg).toBeDefined()
      expect(assistantMsg!.tool_calls).toHaveLength(1)
      expect(assistantMsg!.tool_calls![0].id).toBe('call_1')
    })
  })
})
