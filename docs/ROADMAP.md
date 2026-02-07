# 短期目标

> 唯一规划文件。所有条目完成前不得开发新功能。
> 完成后删除该条目并提交。新需求追加到末尾。

## Checkpoint — 类型安全 + Service Layer 重构
- tsconfig 启用 `noUncheckedIndexedAccess`
- 提取 service layer: `skill-service.ts`, `mcp-service.ts`
- MCP providers 重构：Zod 校验 args，调用 service，消除所有 `as` 断言
- API routes 重构：Zod 校验 body，调用 service，使用 Prisma 生成类型

## Phase 7 — UI
- 基础 Chat UI
