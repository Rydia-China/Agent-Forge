# FC 函数开发指南

## 核心原则

**FC 函数源码归本项目管理，通过 Serverless Devs 进行部署。**

- FC 函数源码存放在 `FC/` 目录，由 Git 追踪
- 不从生产环境导出代码，而是从本地部署到生产环境
- 使用 Serverless Devs 工具进行部署和管理

## 目录结构

```
FC/                          # FC 函数根目录（被 Git 追踪）
├── README.md                # 本说明文件
├── s.yaml                   # Serverless Devs 配置文件（可选）
├── generate-image/          # 图片生成函数
│   ├── index.js             # 函数入口
│   ├── package.json         # 依赖配置
│   ├── s.yaml               # 函数部署配置
│   ├── .env.example         # 环境变量模板
│   └── .env                 # 实际环境变量（不提交）
└── generate-video/          # 视频生成函数
    ├── index.js             # 函数入口
    ├── package.json         # 依赖配置
    ├── s.yaml               # 函数部署配置
    ├── .env.example         # 环境变量模板
    └── .env                 # 实际环境变量（不提交）
```

## Git 管理策略

### 被追踪的内容
- `FC/` 目录本身
- `FC/README.md`
- 各函数的源代码（`index.js`、`package.json`）
- Serverless Devs 配置文件（`s.yaml`）
- 环境变量模板（`.env.example`）

### 被忽略的内容（.gitignore）
```gitignore
FC/**/node_modules/
FC/**/package-lock.json
FC/**/.env
!FC/**/.env.example
FC/**/.s/
```

## 开发流程

### 1. 创建新的 FC 函数

```bash
# 在 FC 目录下创建新函数目录
cd FC/
mkdir generate-image
cd generate-image

# 创建函数入口文件
touch index.js

# 创建 package.json
cat > package.json << 'EOF'
{
  "name": "fc-generate-image",
  "version": "1.0.0",
  "description": "阿里云 FC 函数 - 图片生成",
  "main": "index.js",
  "dependencies": {
    "@google/genai": "^1.31.0",
    "ali-oss": "^6.23.0"
  }
}
EOF

# 创建 Serverless Devs 配置
touch s.yaml
```

### 2. 配置 Serverless Devs

编辑 `s.yaml` 文件：

```yaml
edition: 3.0.0
name: generate-image
access: default

resources:
  generate-image:
    component: fc3
    props:
      region: cn-hangzhou
      functionName: generate-image
      description: 图片生成函数
      runtime: nodejs18
      code: ./
      handler: index.handler
      memorySize: 512
      timeout: 60
      environmentVariables:
        OSS_REGION: ${env(OSS_REGION)}
        OSS_BUCKET: ${env(OSS_BUCKET)}
        OSS_ACCESS_KEY_ID: ${env(OSS_ACCESS_KEY_ID)}
        OSS_ACCESS_KEY_SECRET: ${env(OSS_ACCESS_KEY_SECRET)}
        GEMINI_API_KEY: ${env(GEMINI_API_KEY)}
        GEMINI_MODEL: ${env(GEMINI_MODEL)}
```

### 3. 配置环境变量

```bash
cd FC/generate-image/

# 创建环境变量模板
cat > .env.example << 'EOF'
# OSS 配置
OSS_REGION=
OSS_BUCKET=
OSS_ACCESS_KEY_ID=
OSS_ACCESS_KEY_SECRET=

# Google Gemini API
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3-pro-image-preview
EOF

# 复制并填写实际配置
cp .env.example .env
vim .env
```

`GEMINI_MODEL` 是 FC 部署级固定参数；需要支持多个 Gemini 图片模型时，使用同一份代码部署多个 FC，并为每个部署配置不同的 `GEMINI_MODEL`。

### 4. 本地开发和测试

```bash
cd FC/generate-image/

# 安装依赖
pnpm install

# 编写函数代码
vim index.js

# 本地测试（如果有测试脚本）
node test-local.js
```

### 5. 提交到 Git

```bash
# 在 worktree 中提交
git add FC/generate-image/
git commit -m "feat: add FC generate-image function"
```

## 部署到生产环境

### 前置条件

1. 安装 Serverless Devs CLI：

```bash
npm install -g @serverless-devs/s
```

2. 配置阿里云账号凭证：

```bash
s config add

# 按提示输入：
# - AccountID: 阿里云账号 ID
# - AccessKeyID: RAM 用户 AccessKey ID
# - AccessKeySecret: RAM 用户 AccessKey Secret
# - 别名：default（或自定义）
```

### 部署流程

```bash
cd FC/generate-image/

# 1. 安装依赖（如果还没安装）
pnpm install

# 2. 部署函数
s deploy

# 3. 查看部署信息
s info

# 4. 测试函数（可选）
s invoke -e '{"prompt": "test image"}'
```

### 更新已部署的函数

```bash
cd FC/generate-image/

# 修改代码后重新部署
s deploy

# 仅更新代码（不更新配置）
s deploy --use-local --skip-push

# 仅更新配置（不更新代码）
s deploy function --config-only
```

### 查看函数日志

```bash
cd FC/generate-image/

# 查看实时日志
s logs -t

# 查看最近的日志
s logs --tail 100
```

## 环境变量管理

### 主项目环境变量

主项目的 `.env.example` 中定义了 FC 函数的调用配置：

```bash
# FC 函数（图片/视频生成）
FC_GENERATE_IMAGE_URL=https://your-fc-endpoint.aliyuncs.com/generate-image
FC_GENERATE_IMAGE_TOKEN=your-token-here
FC_GENERATE_VIDEO_URL=https://your-fc-endpoint.aliyuncs.com/generate-video
FC_GENERATE_VIDEO_TOKEN=your-token-here
```

这些变量用于主项目调用 FC 函数，与 FC 函数内部的环境变量无关。

### FC 函数内部环境变量

每个 FC 函数有自己的 `.env` 文件，用于配置函数运行时需要的参数（如 OSS 配置、API Key 等）。

环境变量通过 `s.yaml` 中的 `environmentVariables` 配置，支持从 `.env` 文件读取：

```yaml
environmentVariables:
  OSS_REGION: ${env(OSS_REGION)}
  OSS_BUCKET: ${env(OSS_BUCKET)}
```

部署时，Serverless Devs 会自动从 `.env` 文件读取变量值。

## 常用命令

```bash
# 部署函数
s deploy

# 查看函数信息
s info

# 调用函数
s invoke -e '{"key": "value"}'

# 查看日志
s logs -t

# 删除函数
s remove

# 查看帮助
s --help
```

## 注意事项

### 1. 源码管理原则

- **FC 函数源码归本项目管理** — 所有 FC 函数代码都在 `FC/` 目录下，由 Git 追踪
- **不从生产环境导出代码** — 代码变更在本地完成，通过 Serverless Devs 部署到生产环境
- **版本控制** — 使用 Git 管理代码版本，不依赖 FC 控制台的版本管理

### 2. 不要在主项目中实现 FC 客户端

FC 函数的调用逻辑应该在主项目的 service 层实现，但不要创建独立的 `fc-*-client.ts` 文件。

如果需要调用 FC 函数，直接在对应的 service 中使用 `fetch` 调用即可：

```typescript
// ❌ 不推荐：创建独立的 FC 客户端
// src/lib/services/fc-image-client.ts

// ✅ 推荐：在需要的 service 中直接调用
// src/lib/services/key-resource-service.ts
const response = await fetch(process.env.FC_GENERATE_IMAGE_URL!, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.FC_GENERATE_IMAGE_TOKEN}`,
  },
  body: JSON.stringify({ prompt }),
});
```

### 3. FC 函数是独立的运行时

- FC 函数运行在阿里云的 Node.js 环境中，与主项目完全隔离
- FC 函数的依赖（`package.json`）与主项目无关
- FC 函数的环境变量（`.env`）与主项目无关

### 4. 部署最佳实践

- **使用 Serverless Devs** — 统一使用 `s deploy` 命令部署，不要手动上传代码包
- **环境变量分离** — 敏感信息（如 API Key）通过 `.env` 文件管理，不提交到 Git
- **配置文件版本化** — `s.yaml` 配置文件提交到 Git，便于团队协作和版本追溯
- **测试后部署** — 本地测试通过后再部署到生产环境

## 常见问题

### Q: 为什么不把 FC 函数放在 `src/` 下？

A: FC 函数是独立的运行时环境，不是主项目的一部分。放在根目录的 `FC/` 下可以清晰地表明这一点，避免与主项目代码混淆。

### Q: 如何更新 FC 函数？

A: 在本地修改 `FC/` 目录下的代码，提交到 Git，然后使用 `s deploy` 部署到生产环境。

### Q: FC 函数的 node_modules 会被提交吗？

A: 不会，`.gitignore` 已配置忽略 `FC/**/node_modules/`。部署时 Serverless Devs 会自动安装依赖。

### Q: 如何在主项目中调用 FC 函数？

A: 使用环境变量中配置的 URL 和 Token，通过 HTTP 请求调用。参考 `src/lib/services/` 中的实现。

### Q: 如何回滚到之前的版本？

A: 使用 Git 回退到之前的提交，然后重新部署：

```bash
# 查看历史提交
git log --oneline FC/generate-image/

# 回退到指定版本
git checkout <commit-hash> -- FC/generate-image/

# 重新部署
cd FC/generate-image/
s deploy
```

### Q: 如何管理多个环境（开发/生产）？

A: 在 `s.yaml` 中配置多个 access 和 region，使用不同的部署命令：

```yaml
# s.yaml
edition: 3.0.0
name: generate-image

resources:
  generate-image-dev:
    component: fc3
    access: dev
    props:
      region: cn-hangzhou
      functionName: generate-image-dev
      # ...

  generate-image-prod:
    component: fc3
    access: prod
    props:
      region: cn-hangzhou
      functionName: generate-image
      # ...
```

```bash
# 部署到开发环境
s generate-image-dev deploy

# 部署到生产环境
s generate-image-prod deploy
```

## 参考资料

- [Serverless Devs 官方文档](https://docs.serverless-devs.com/)
- [阿里云函数计算文档](https://help.aliyun.com/product/50980.html)
- [FC3 组件文档](https://docs.serverless-devs.com/fc3/readme)
