import { vi } from 'vitest'
import type { ChatMessage } from '@/generated/prisma'

export class MessageBuilder {
  private message: Partial<ChatMessage> = {
    id: `msg_${Date.now()}`,
    sessionId: 'session_test',
    role: 'user',
    content: 'Test message',
    images: [],
    createdAt: new Date(),
    toolCalls: null,
    toolCallId: null,
    hidden: false,
  }

  withId(id: string): this {
    this.message.id = id
    return this
  }

  withSessionId(sessionId: string): this {
    this.message.sessionId = sessionId
    return this
  }

  withRole(role: 'user' | 'assistant' | 'tool' | 'system'): this {
    this.message.role = role
    return this
  }

  withContent(content: string): this {
    this.message.content = content
    return this
  }

  withToolCalls(toolCalls: Array<{ id: string; type: string; function: { name: string; arguments: string } }>): this {
    this.message.toolCalls = toolCalls as never
    return this
  }

  withToolCallId(toolCallId: string): this {
    this.message.toolCallId = toolCallId
    this.message.role = 'tool'
    return this
  }

  withCreatedAt(date: Date): this {
    this.message.createdAt = date
    return this
  }

  build(): ChatMessage {
    return this.message as ChatMessage
  }
}

export function createOpenAIMessage(
  role: 'user' | 'assistant' | 'tool' | 'system',
  content: string,
  options?: {
    toolCalls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>
    toolCallId?: string
  }
) {
  const message: Record<string, unknown> = { role, content }
  
  if (options?.toolCalls) {
    message.tool_calls = options.toolCalls
  }
  
  if (options?.toolCallId) {
    message.tool_call_id = options.toolCallId
  }
  
  return message
}

export function createMockAbortController() {
  const controller = new AbortController()
  const abortSpy = vi.fn(() => {
    controller.signal.dispatchEvent(new Event('abort'))
  })
  
  controller.abort = abortSpy
  
  return { controller, abortSpy }
}

export function createMockStream(chunks: string[]) {
  let index = 0
  
  return new ReadableStream({
    async pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(new TextEncoder().encode(chunks[index]))
        index++
      } else {
        controller.close()
      }
    },
  })
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
