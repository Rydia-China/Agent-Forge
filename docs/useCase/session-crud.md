# Use Case: Session CRUD（用户隔离）

## 场景
验证 session 的完整生命周期：创建、列出、查看、改名、删除，以及不同用户之间的隔离。

## 前置条件
- 服务已启动

## 验证步骤

### 1. 用户 A 创建会话
```bash
curl -v -s -X POST http://localhost:8001/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"hello", "user":"alice"}' \
  2>&1 | tee temp/session-crud.1.txt
```
期望：返回 `session_id`（非空）。记录为 `SESSION_A`。

### 2. 用户 B 创建会话
```bash
curl -v -s -X POST http://localhost:8001/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"hi", "user":"bob"}' \
  2>&1 | tee temp/session-crud.2.txt
```
期望：返回 `session_id`（非空）。记录为 `SESSION_B`。

### 3. 用户 A 列出 sessions — 只能看到自己的
```bash
curl -v -s 'http://localhost:8001/api/sessions?user=alice' \
  2>&1 | tee temp/session-crud.3.txt
```
期望：
- 列表中包含 `SESSION_A`
- 列表中**不**包含 `SESSION_B`

### 4. 用户 B 列出 sessions — 只能看到自己的
```bash
curl -v -s 'http://localhost:8001/api/sessions?user=bob' \
  2>&1 | tee temp/session-crud.4.txt
```
期望：
- 列表中包含 `SESSION_B`
- 列表中**不**包含 `SESSION_A`

### 5. 查看 session 详情（含 messages）
```bash
curl -v -s http://localhost:8001/api/sessions/<SESSION_A> \
  2>&1 | tee temp/session-crud.5.txt
```
期望：
- 返回 `id`、`title`、`messages` 字段
- `messages` 包含至少 2 条消息（user + assistant）

### 6. 修改 session title
```bash
curl -v -s -X PATCH http://localhost:8001/api/sessions/<SESSION_A> \
  -H 'Content-Type: application/json' \
  -d '{"title":"Alice 的测试会话"}' \
  2>&1 | tee temp/session-crud.6.txt
```
期望：返回 `{ "id": "<SESSION_A>", "title": "Alice 的测试会话" }`。

### 7. 验证 title 已更新
```bash
curl -v -s 'http://localhost:8001/api/sessions?user=alice' \
  2>&1 | tee temp/session-crud.7.txt
```
期望：`SESSION_A` 的 `title` 为 `"Alice 的测试会话"`。

### 8. 删除 session
```bash
curl -v -s -X DELETE http://localhost:8001/api/sessions/<SESSION_A> \
  2>&1 | tee temp/session-crud.8.txt
```
期望：返回 `{ "deleted": "<SESSION_A>" }`。

### 9. 确认已删除
```bash
curl -v -s http://localhost:8001/api/sessions/<SESSION_A> \
  2>&1 | tee temp/session-crud.9.txt
```
期望：返回 404。

### 10. 确认用户 A 列表为空
```bash
curl -v -s 'http://localhost:8001/api/sessions?user=alice' \
  2>&1 | tee temp/session-crud.10.txt
```
期望：返回空数组 `[]`。

### 11. 清理用户 B
```bash
curl -v -s -X DELETE http://localhost:8001/api/sessions/<SESSION_B> \
  2>&1 | tee temp/session-crud.11.txt
```
期望：返回 `{ "deleted": "<SESSION_B>" }`。
