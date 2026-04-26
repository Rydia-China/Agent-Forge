# FC 函数开发指南

## 目录结构

```
FC/                          # FC 函数根目录（被 Git 追踪）
├── README.md                # 本说明文件
├── generate-image/          # 图片生成函数
│   ├── index.js             # 函数入口
│   ├── package.json         # 依赖配置
│   ├── .env.example         # 环境变量模板
│   └── .env                 # 实际环境变量（不提交）
└── generate-video/          # 视频生成函数
    ├── index.js             # 函数入口
    ├── package.json         # 依赖配置
    ├── .env.example         # 环境变量模板
    └── .env                 # 实际环境变量（不提交）
```

## Git 管理策略

### 被追踪的内容
- `FC/` 目录本身
- `FC/README.md`
- 各函数的源代码（`index.js`、`package.json`）
- 环境变量模板（`.env.example`）

### 被忽略的内容（.gitignore）
```gitignore
FC/**/node_modules/
FC/**/package-lock.json
FC/**/.env
!FC/**/.env.example
```

## 开发流程

### 1. 从生产环境导出 FC 函数

在阿里云 FC 控制台导出函数代码包（zip 文件）。

### 2. 导入到本地仓库

```bash
# 解压到 FC 目录
cd FC/
unzip /path/to/exported-function.zip -d generate-image/

# 或使用 cp 命令复制已解压的目录
cp -r /path/to/exported-function/* generate-image/
```

### 3. 配置环境变量

```bash
cd FC/generate-image/

# 复制环境变量模板
cp .env.example .env

# 编辑 .env 填入实际配置
vim .env
```

### 4. 本地测试（可选）

如果函数支持本地测试：

```bash
cd FC/generate-image/

# 安装依赖
pnpm install

# 运行测试脚本（如果有）
node test-local.js
```

### 5. 提交到 Git

```bash
# 在 worktree 中提交
git add FC/
git commit -m "feat: add FC generate-image function"
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

## 部署到生产环境

### 方式一：通过 FC 控制台

1. 将 `FC/generate-image/` 目录打包为 zip
2. 在 FC 控制台上传代码包
3. 配置环境变量
4. 发布版本

### 方式二：通过 CLI 工具（推荐）

```bash
# 安装阿里云 FC CLI
npm install -g @alicloud/fun

# 部署函数
cd FC/generate-image/
fun deploy
```

## 注意事项

### 1. 不要在主项目中实现 FC 客户端

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

### 2. FC 函数是独立的运行时

- FC 函数运行在阿里云的 Node.js 环境中，与主项目完全隔离
- FC 函数的依赖（`package.json`）与主项目无关
- FC 函数的环境变量（`.env`）与主项目无关

### 3. 版本同步

- 从生产环境导出的 FC 函数代码是当前运行版本的快照
- 本地修改后需要重新部署才能生效
- 建议在 FC 函数目录中添加版本号或时间戳注释

## 常见问题

### Q: 为什么不把 FC 函数放在 `src/` 下？

A: FC 函数是独立的运行时环境，不是主项目的一部分。放在根目录的 `FC/` 下可以清晰地表明这一点。

### Q: 如何更新 FC 函数？

A: 从生产环境重新导出，覆盖本地 `FC/` 目录中的对应函数，然后提交到 Git。

### Q: FC 函数的 node_modules 会被提交吗？

A: 不会，`.gitignore` 已配置忽略 `FC/**/node_modules/`。

### Q: 如何在主项目中调用 FC 函数？

A: 使用环境变量中配置的 URL 和 Token，通过 HTTP 请求调用。参考 `src/lib/services/` 中的实现。
