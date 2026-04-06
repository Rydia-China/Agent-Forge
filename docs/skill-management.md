# Skill 管理规范

Skills 存储在 DB（`Skill` + `SkillVersion`），通过 REST API 管理。**禁止使用 seed 脚本**。

## 为什么不用 seed 脚本

- Skill 内容是**运行时数据**，不是代码——它随业务迭代而变化，版本历史保存在 DB
- Seed 脚本把 skill 内容硬编码在 TypeScript 里，导致：真实版本在 DB，代码里又有一份，两处不同步
- DB 已经有完整的版本机制（`SkillVersion`），seed 脚本绕过了这个机制

## API 操作速查

> 端口 `8001`（env `PORT`）

### 列出所有 skills
```
curl http://localhost:8001/api/skills
```

### 查看 skill 详情（JSON）
```
curl http://localhost:8001/api/skills/{name}
```

### 查看 skill（SKILL.md 格式）
```
curl -H 'Accept: text/markdown' http://localhost:8001/api/skills/{name}
```

### 创建 skill（JSON）
```
curl -X POST http://localhost:8001/api/skills \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "my-skill",
    "description": "做什么的",
    "content": "# Skill 正文\n\nMarkdown 内容",
    "tags": ["tag1"]
  }'
```

### 创建 skill（SKILL.md）
```
curl -X POST http://localhost:8001/api/skills \
  -H 'Content-Type: text/markdown' \
  --data-binary @path/to/SKILL.md
```

### 更新 skill（推新版本）
```
curl -X PUT http://localhost:8001/api/skills/{name} \
  -H 'Content-Type: application/json' \
  -d '{
    "description": "新描述",
    "content": "# 新内容",
    "tags": ["video"]
  }'
```
默认自动 promote 到 production。传 `"promote": false` 可只创建版本不切换。

### 回退到指定版本
```
curl -X PUT http://localhost:8001/api/skills/{name}/production \
  -H 'Content-Type: application/json' \
  -d '{"version": 3}'
```

### 查看版本历史
```
curl http://localhost:8001/api/skills/{name}/versions
```

### 删除 skill
```
curl -X DELETE http://localhost:8001/api/skills/{name}
```

## Agent 内部操作

Agent 通过 MCP tools 管理 skills（底层调用相同 service）：
- `skills__list` — 索引（name + description）
- `skills__get` — 读取全文（progressive disclosure）
- `skills__create` / `skills__update` / `skills__delete`

## 操作原则

1. **所有 skill 变更通过 API**——不写脚本、不直连 DB
2. **版本历史自动保留**——每次 PUT 创建新版本，可随时回退
3. **先查后改**——改之前先 `GET` 看当前内容，避免覆盖他人改动
4. **content 是 Markdown**——换行用 `\n`，引号需转义
