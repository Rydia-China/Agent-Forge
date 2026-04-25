# Test Helpers

测试工具库，提供可复用的 mocks, fixtures, builders。

## 使用方式

### Fixtures - 快速创建测试数据

```typescript
import { createMockUser, createMockSession, createMockMessage, createMockTask } from '@/../test/helpers/fixtures'

const user = createMockUser({ name: 'Custom Name' })
const session = createMockSession({ userId: user.id })
const message = createMockMessage({ sessionId: session.id, content: 'Hello' })
const task = createMockTask({ status: 'completed' })
```

### Builders - 流式构建复杂对象

```typescript
import { MessageBuilder } from '@/../test/helpers/builders'

const message = new MessageBuilder()
  .withRole('assistant')
  .withToolCalls([{ id: 'call_1', type: 'function', function: { name: 'test', arguments: '{}' } }])
  .build()
```

### Prisma Mocks - 模拟数据库操作

```typescript
import { createPrismaMock, createTransactionMock } from '@/../test/helpers/prisma-mock'
import { vi } from 'vitest'

const prismaMock = createPrismaMock()
vi.mocked(prismaMock.chatSession.findUnique).mockResolvedValue(mockSession)

const txMock = createTransactionMock()
prismaMock.$transaction.mockImplementation(txMock.execute)
txMock.state.shouldFail = true
```

## 文件说明

- `fixtures.ts` - 预定义测试数据（User, Session, Message, Task, Conversation）
- `builders.ts` - Builder 模式构建器（MessageBuilder, OpenAI message, AbortController, Stream）
- `prisma-mock.ts` - Prisma Client 完整 mock（包含事务支持）
