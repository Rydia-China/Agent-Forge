# Use Case: Chat + 并行 Title 生成

## 场景
用户发起新会话，客户端拿到 `session_id` 后并行调用 title 生成接口。
验证两个请求可以并行完成，且 title 正确生成并持久化。

## 前置条件
- 服务已启动，LLM API key 已配置
- `LLM_TITLE_MODEL` 已配置（默认 `gpt-4o-mini`）

## 验证步骤

### 1. 发起新会话
```bash
curl -v -s -X POST http://localhost:8001/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"帮我写一个 Python 快速排序", "user":"test-user"}' \
  2>&1 | tee temp/chat-with-title.1.txt
```
期望：返回 `session_id`（非空）和 `reply`（非空）。
记录 `session_id`。

### 2. 并行生成 title
使用步骤 1 返回的 `session_id`：
```bash
curl -v -s -X POST http://localhost:8001/api/sessions/<session_id>/title \
  -H 'Content-Type: application/json' \
  -d '{"message":"帮我写一个 Python 快速排序"}' \
  2>&1 | tee temp/chat-with-title.2.txt
```
期望：
- 返回 `{ "id": "<session_id>", "title": "..." }`
- `title` 非空，≤20 个字符，与用户消息语义相关（如包含"排序"或"Python"等关键词）
- `title` 不带引号，不以标点结尾

### 3. 验证 title 已持久化
```bash
curl -v -s http://localhost:8001/api/sessions/<session_id> \
  2>&1 | tee temp/chat-with-title.3.txt
```
期望：返回的 session 对象中 `title` 字段与步骤 2 返回的一致。

### 4. 验证 session 出现在列表中
```bash
curl -v -s 'http://localhost:8001/api/sessions?user=test-user' \
  2>&1 | tee temp/chat-with-title.4.txt
```
期望：列表中包含步骤 1 创建的 session，且 `title` 非空。

### 5. 清理
```bash
curl -v -s -X DELETE http://localhost:8001/api/sessions/<session_id> \
  2>&1 | tee temp/chat-with-title.5.txt
```
期望：返回 `{ "deleted": "<session_id>" }`。
