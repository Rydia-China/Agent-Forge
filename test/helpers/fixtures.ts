import type { ChatSession, ChatMessage, Task, User } from '@/generated/prisma'

export function createMockUser(overrides?: Partial<User>): User {
  return {
    id: 'user_test123',
    name: 'Test User',
    ...overrides,
  }
}

export function createMockSession(overrides?: Partial<ChatSession>): ChatSession {
  return {
    id: 'session_test123',
    userId: 'user_test123',
    title: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  }
}

export function createMockMessage(overrides?: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'msg_test123',
    sessionId: 'session_test123',
    role: 'user',
    content: 'Test message',
    images: [],
    toolCalls: null,
    toolCallId: null,
    hidden: false,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  }
}

export function createMockTask(overrides?: Partial<Task>): Task {
  return {
    id: 'task_test123',
    sessionId: 'session_test123',
    status: 'pending',
    input: { message: 'Test task' },
    reply: null,
    error: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  }
}

export function createMockConversation(sessionId: string): ChatMessage[] {
  return [
    createMockMessage({
      id: 'msg_1',
      sessionId,
      role: 'user',
      content: 'Hello',
      createdAt: new Date('2024-01-01T00:00:00Z'),
    }),
    createMockMessage({
      id: 'msg_2',
      sessionId,
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'call_1', type: 'function', function: { name: 'test_tool', arguments: '{}' } }] as never,
      createdAt: new Date('2024-01-01T00:00:01Z'),
    }),
    createMockMessage({
      id: 'msg_3',
      sessionId,
      role: 'tool',
      content: 'Tool result',
      toolCallId: 'call_1',
      createdAt: new Date('2024-01-01T00:00:02Z'),
    }),
    createMockMessage({
      id: 'msg_4',
      sessionId,
      role: 'assistant',
      content: 'Done',
      createdAt: new Date('2024-01-01T00:00:03Z'),
    }),
  ]
}

export function createMockConversationWithDanglingToolCall(sessionId: string): ChatMessage[] {
  return [
    createMockMessage({
      id: 'msg_1',
      sessionId,
      role: 'user',
      content: 'Hello',
    }),
    createMockMessage({
      id: 'msg_2',
      sessionId,
      role: 'assistant',
      content: '',
      toolCalls: [
        { id: 'call_1', type: 'function', function: { name: 'tool_1', arguments: '{}' } },
        { id: 'call_2', type: 'function', function: { name: 'tool_2', arguments: '{}' } },
      ] as never,
    }),
    createMockMessage({
      id: 'msg_3',
      sessionId,
      role: 'tool',
      content: 'Result 1',
      toolCallId: 'call_1',
    }),
  ]
}
