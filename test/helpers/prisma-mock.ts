import { vi } from 'vitest'
import type { PrismaClient } from '@/generated/prisma'

/**
 * 创建 Prisma Client 的完整 mock
 * 
 * 使用方式:
 * ```ts
 * const prismaMock = createPrismaMock()
 * vi.mocked(prismaMock.chatSession.findUnique).mockResolvedValue(mockSession)
 * ```
 */
export function createPrismaMock() {
  return {
    chatSession: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      upsert: vi.fn(),
    },
    chatMessage: {
      findMany: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    task: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    skill: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    skillVersion: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    keyResource: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      upsert: vi.fn(),
    },
    keyResourceVersion: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      upsert: vi.fn(),
    },
    $transaction: vi.fn(function (this: unknown, callback: unknown) {
      const mockClient = this as unknown as PrismaClient
      if (typeof callback === 'function') {
        return callback(mockClient)
      }
      return Promise.all(callback as Promise<unknown>[])
    }),
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
  } as unknown as PrismaClient
}

/**
 * 创建事务 mock，用于测试事务原子性
 * 
 * 使用方式:
 * ```ts
 * const txMock = createTransactionMock()
 * prismaMock.$transaction.mockImplementation(txMock.execute)
 * 
 * // 模拟事务失败
 * txMock.shouldFail = true
 * ```
 */
export function createTransactionMock() {
  const state = {
    shouldFail: false,
    operations: [] as string[],
  }

  return {
    state,
    execute: vi.fn(async (callback: (tx: PrismaClient) => Promise<unknown>) => {
      if (state.shouldFail) {
        throw new Error('Transaction failed')
      }
      const txMock = createPrismaMock()
      return callback(txMock)
    }),
    reset: () => {
      state.shouldFail = false
      state.operations = []
    },
  }
}
