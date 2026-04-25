import type { User, ChatSession, ChatMessage, Task } from '@/generated/prisma';

export function createMockUser(overrides?: Partial<User>): User {
  return {
    id: 'user_test123',
    name: 'test-user',
    ...overrides,
  };
}

export function createMockSession(overrides?: Partial<ChatSession>): ChatSession {
  return {
    id: 'session_test123',
    userId: 'user_test123',
    title: 'Test Session',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
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
    createdAt: new Date(),
    ...overrides,
  };
}

export function createMockTask(overrides?: Partial<Task>): Task {
  return {
    id: 'task_test123',
    sessionId: 'session_test123',
    status: 'pending',
    input: { message: 'test' },
    reply: null,
    error: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function createMockConversation(messageCount: number = 3) {
  const messages: ChatMessage[] = [];
  for (let i = 0; i < messageCount; i++) {
    messages.push(
      createMockMessage({
        id: `msg_${i}`,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`,
      })
    );
  }
  return messages;
}

export function createMockConversationWithDanglingToolCall() {
  return [
    createMockMessage({
      id: 'msg_1',
      role: 'user',
      content: 'Do something',
    }),
    createMockMessage({
      id: 'msg_2',
      role: 'assistant',
      content: null,
      toolCalls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'test_tool', arguments: '{}' },
        },
      ],
    }),
  ];
}
