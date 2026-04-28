# Skills API Quick Reference

快速查询 Skills 的 curl 命令，避免每次都需要搜索代码。

## 基础信息
- 开发环境端口: `8001`
- Base URL: `http://localhost:8001`

## 常用命令

### 列出所有 Skills（元数据）
```bash
curl http://localhost:8001/api/skills
```

### 获取单个 Skill（JSON 格式）
```bash
curl http://localhost:8001/api/skills/<skill-name>
```

### 获取单个 Skill（Markdown 格式）
```bash
curl -H "Accept: text/markdown" http://localhost:8001/api/skills/<skill-name>
```

### 创建 Skill（JSON 格式）
```bash
curl -X POST http://localhost:8001/api/skills \
  -H "Content-Type: application/json" \
  -d '{
    "name": "skill-name",
    "description": "Skill description",
    "content": "# Skill content in markdown"
  }'
```

### 创建 Skill（Markdown 格式）
```bash
curl -X POST http://localhost:8001/api/skills \
  -H "Content-Type: text/markdown" \
  --data-binary @skill.md
```

### 更新 Skill（推送新版本）
```bash
curl -X PUT http://localhost:8001/api/skills/<skill-name> \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Updated description",
    "content": "# Updated content"
  }'
```

### 删除 Skill
```bash
curl -X DELETE http://localhost:8001/api/skills/<skill-name>
```

## 版本管理

### 列出 Skill 的所有版本
```bash
curl http://localhost:8001/api/skills/<skill-name>/versions
```

### 获取特定版本
```bash
curl http://localhost:8001/api/skills/<skill-name>/versions/<version>
```

### 获取生产版本
```bash
curl http://localhost:8001/api/skills/<skill-name>/production
```

## 使用建议

1. **AI Agent 查询 Skills 时优先使用这些命令**，避免每次都搜索代码
2. **开发环境默认端口是 8001**，如果修改了端口需要相应调整
3. **Markdown 格式适合直接查看 Skill 内容**，JSON 格式适合程序处理
4. **更新 Skill 会自动推送新版本**，默认自动提升为生产版本
