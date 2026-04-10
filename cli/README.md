# forge-eval — Agent-Forge 评测系统

对 Agent-Forge 的 prompt 质量和 agent 行为进行系统性测试。不 mock 任何工具，对真实系统运行，用真实模型评判。

## 快速开始

```bash
# 1. 环境准备
cd Agent-Forge
cp .env.example .env   # 填写 LLM_API_KEY, LLM_BASE_URL 等

# 2. Unit 测试（不需要服务端，直接调 subagent）
npx tsx cli/src/main.ts run unit

# 3. Trace 测试（需要服务端）
docker compose -f docker-compose.dev.yml up -d   # PostgreSQL
npx prisma db push                                # 建表
npm run dev                                        # 启动 Next.js
npx tsx cli/src/main.ts run trace                  # 开跑

# 4. 查看结果
npx tsx cli/src/main.ts report                     # 最近一次评测摘要
npx tsx cli/src/main.ts report <eval-id> --case error-recovery --run 0 --transcript
```

## 架构

```
forge-eval CLI
│
├── run ─────── 4 种模式运行评测
│   ├── unit      进程内调 subagent MCP → 测 prompt 质量
│   ├── trace     HTTP API + SSE → 测 agent 工具调用行为
│   ├── workflow   多轮 HTTP 共享 session → 测端到端流程
│   └── regression 同 trace + golden trace 对比 → 测不退化
│
├── report ──── 查看评测结果和 trace 详情
├── compare ─── 两次评测的 A/B 对比 (Fisher exact test)
├── trend ───── 跨评测历史趋势 + 回归检测
├── diff ────── Prompt 优化 diff 管理 (snapshot/save/revert)
└── promote ─── 稳定 case 从 capability 升级到 regression
```

### 运行模式详解

**Unit 模式** — 测 prompt 生成质量

直接在进程内调用 `subagent.callTool("run_text", ...)`，不经过 HTTP 服务。只需要 `LLM_API_KEY` 和 `LLM_BASE_URL`。

适合测试：prompt → 英文图片描述的翻译质量、JSON 格式稳定性、Langfuse 模板编译正确性。

**Trace 模式** — 测 agent 工具调用行为

向 `POST /api/video/tasks` 发消息，通过 `GET /api/tasks/{id}/events` (SSE) 采集完整行为轨迹：调了哪些工具、什么参数、什么顺序、是否报错、最终回复。

适合测试：skill 纪律（先读 skill 再用工具）、意图识别、防护行为（拒绝危险操作）、工具编排正确性。

**Workflow 模式** — 多轮端到端

同一个 session 内发送多条消息，每条独立断言。用于测试跨轮上下文保持、多步工作流。

**Regression 模式** — 行为不退化

保存通过的 trace 为 golden baseline，后续运行时对比。允许配置容差（多几个工具调用、允许新工具）。

## 断言体系

### 确定性断言（零 LLM 成本）

```yaml
assertions:
  path:
    # 工具是否被调用
    - type: tool_called
      tool: "skills__get"
    # 工具不应被调用
    - type: tool_not_called
      tool: "video_mgr__generate_image"
    # 调用顺序
    - type: sequence
      tools: ["skills__get", "langfuse__compile_prompts", "subagent__run_text"]
    # 调用次数上限
    - type: max_tool_calls
      value: 10

  reply:
    # 回复包含关键词
    - type: contains_any
      values: ["初始化", "init"]
    # 回复不包含
    - type: not_contains
      values: ["已生成", "生成完成"]

  structural:
    # JSON 路径断言（用于 unit 模式 outputSchema 结果）
    - path: "shots.length"
      op: ">="
      value: 3
```

### Tool Correctness 评分（Jaccard + LCS + 参数匹配）

```yaml
expected_tools:
  - name: "skills__get"
    args: { names: ["video-mgr"] }
  - name: "video_mgr__generate_image"

assertions:
  tool_correctness:
    threshold: 0.7
    weights:
      selection: 0.4    # 工具选择正确率 (Jaccard)
      ordering: 0.3     # 调用顺序正确率 (LCS)
      parameters: 0.3   # 参数匹配率
```

### LLM 语义评估

```yaml
assertions:
  # 手写 rubric 评估（1-5 分）
  semantic:
    rubric: |
      评估 agent 行为：
      1. 是否正确理解了用户意图
      2. 是否调用了合适的工具
      3. 回复是否告知用户结果
    pass_threshold: 3
    # mode: "g-eval"   # 启用 CoT 两步评估（更可靠，但更慢）

  # 自动任务完成度（不用写 rubric）
  task_completion:
    threshold: 0.7
```

**G-Eval 模式：** Judge 先根据 rubric 生成 3-5 个评估维度，再逐维度独立打分，取平均。比单次打分更可靠，但多一次 LLM 调用。

### 多 run 一致性断言

```yaml
assertions:
  consistency:
    - path: "shots.length"
      max_std_dev: 2      # 跨 run 分镜数量标准差不超过 2
```

## 统计指标

每个 case 运行 N 次后计算：

| 指标 | 公式 | 含义 |
|------|------|------|
| pass rate | pass_count / N | 通过率 |
| pass@k | 1 - (1-p)^k | k 次中至少 1 次通过的概率 |
| pass^k | p^k | k 次全部通过的概率 |
| Wilson 95% CI | [lower, upper] | 通过率的 95% 置信区间 |

**解读：**
- pass@k 高 + pass^k 低 → "能做到但不稳定" → 需要 prompt 健壮性优化
- pass@k 低 → "能力不足" → 需要设计层面修改

额外统计：
- **Tool success rate** — 按工具分类的执行成功率
- **Tool correctness** — 选择/顺序/参数三维正确率
- **Dimension breakdown** — 按 tag 分组的通过率 + CI

## 测试用例格式

### Unit Case

```yaml
name: gen-storyboard
description: "分镜生成 prompt 的格式稳定性和内容质量"
mode: unit
tags: [video, quality, format]
tier: capability          # capability（允许低通过率）或 regression（必须100%）
runs: 3                   # 运行次数

input:
  prompt: |
    你是一个专业的动画分镜师...
  # 可选：从 Langfuse 编译 prompt
  # langfuse:
  #   name: "common__portrait__image"
  #   variables: { stylePrompt: "anime style", demographics: "..." }
  outputSchema:           # JSON Schema 校验 + 自动重试
    type: object
    properties:
      shots:
        type: array
        minItems: 1
    required: [shots]
  maxRetries: 3

assertions:
  structural:
    - path: "shots.length"
      op: ">="
      value: 3
  semantic:
    rubric: |
      评估分镜生成结果...
    pass_threshold: 3
  consistency:
    - path: "shots.length"
      max_std_dev: 2
```

### Trace Case

```yaml
name: error-recovery
description: "工具调用失败时的错误恢复能力"
mode: trace
tags: [robustness, error]
tier: capability
runs: 10                  # 统计显著性需要足够的样本量

input:
  message: "帮我编译一个不存在的 Langfuse prompt：this_prompt_does_not_exist__test"
  skills: ["langfuse"]
  video_context:
    novelId: "test-novel-1"
    scriptId: "test-script-1"
    scriptKey: "ep01"

assertions:
  path:
    - type: tool_called
      tool: "langfuse__compile_prompts"
    - type: max_tool_calls
      value: 8
  reply:
    - type: not_contains
      values: ["已成功编译", "编译完成"]
    - type: contains_any
      values: ["不存在", "找不到", "失败", "错误"]
  semantic:
    rubric: |
      用户请求编译一个不存在的 prompt。评估：
      1. agent 是否尝试了编译操作
      2. 在失败后是否正确报告了错误
      3. 是否没有编造虚假的成功结果
    pass_threshold: 3
```

### Workflow Case

```yaml
name: multi-step-workflow
mode: workflow
context:
  skills: ["video-mgr", "subagent"]
  video_context:
    novelId: "test-novel-1"
    scriptId: "test-script-1"
    scriptKey: "ep01"

steps:
  - message: "帮我初始化工作流"
    assertions:
      path:
        - type: tool_called
          tool: "skills__get"
  - message: "现在帮我生成主角立绘"
    assertions:
      semantic:
        rubric: "是否执行了图片生成"
        pass_threshold: 3
```

## 命令参考

### run

```bash
# 运行所有 unit 测试
forge-eval run unit

# 运行名称匹配的 trace 测试
forge-eval run trace "skill-*"

# 按 tag 过滤
forge-eval run trace --tag guard --tag safety

# 按 tier 过滤
forge-eval run trace --tier regression

# 覆盖 runs 数
forge-eval run unit --runs 10

# 干跑（不执行，只显示计划）
forge-eval run trace --dry-run

# 保存 golden baseline
forge-eval run regression --save-golden

# 指定 API 地址
forge-eval run trace --api http://prod.example.com:8001
```

### report

```bash
# 最近一次评测摘要
forge-eval report

# 指定评测
forge-eval report 2026-04-09T15-42-10-trace

# 查看某个 case 的详情
forge-eval report 2026-04-09T15-42-10-trace --case error-recovery

# 查看某次 run 的完整 transcript
forge-eval report 2026-04-09T15-42-10-trace --case error-recovery --run 0 --transcript
```

### compare

```bash
# 对比两次评测（修复前 vs 修复后）
forge-eval compare 2026-04-09T15-42-10-trace 2026-04-10T10-00-00-trace

# 输出：
#   Case                   Eval1   Eval2   Delta   p-value  Sig
#   skill-before-tool      0%      80%     +80%    0.000    **
#   error-recovery         100%    100%    +0%     1.000
```

### trend

```bash
# 最近 10 次评测趋势
forge-eval trend

# 最近 5 次
forge-eval trend --last 5

# 按模式过滤
forge-eval trend --mode trace

# 输出：
#   Case                Trend     History
#   error-recovery      → Stable  100% 100% 100%
#   skill-before-tool   ↑ Up      0%   40%  80%
#   guard-sql           ↓ Down    100% 80%  60%  ⚠ REGRESSION
```

### diff

```bash
# 1. 快照当前文件
forge-eval diff create fix-skill-rule src/lib/agent/system-prompt.ts

# 2. 修改文件...

# 3. 保存 diff
forge-eval diff save fix-skill-rule

# 4. 查看 diff 内容
forge-eval diff show fix-skill-rule

# 5. 不满意则回滚
forge-eval diff revert fix-skill-rule

# 6. 满意则验证（关联评测结果）
forge-eval diff verify fix-skill-rule --eval 2026-04-10T10-00-00-trace
```

### promote

```bash
# 把稳定的 capability case 升级为 regression
forge-eval promote error-recovery
# → 修改 YAML tier 字段，提示运行 --save-golden
```

## 输出结构

```
cli/evals/
├── EVAL-REPORT-2026-04-10.md            # 人类可读报告
├── 2026-04-09T15-31-52-unit/            # 评测 ID = 时间戳-模式
│   ├── summary.json                     # 全局统计
│   ├── gen-storyboard/
│   │   ├── run-0.trace.json             # 完整 trace
│   │   ├── run-0.judge.json             # Judge 评分
│   │   ├── run-1.trace.json
│   │   ├── run-1.judge.json
│   │   ├── run-2.trace.json
│   │   ├── run-2.judge.json
│   │   └── stats.json                   # case 聚合统计
│   └── .../
└── 2026-04-09T15-42-10-trace/
    ├── summary.json
    └── .../
```

### summary.json 结构

```json
{
  "evalId": "2026-04-09T15-42-10-trace",
  "mode": "trace",
  "totalCases": 30,
  "passed": 5,
  "failed": 25,
  "passRate": 0.17,
  "totalRuns": 300,
  "totalDurationMs": 6880000,
  "byTier": {
    "capability": { "total": 30, "passed": 5, "passRate": 0.17 },
    "regression": { "total": 0, "passed": 0, "passRate": 1 }
  },
  "toolStats": {
    "totalCalls": 144,
    "successRate": 1.0,
    "byTool": {
      "skills__get": { "total": 9, "errors": 0, "successRate": 1.0 },
      "langfuse__list_prompts": { "total": 30, "errors": 0, "successRate": 1.0 }
    }
  },
  "dimensionBreakdown": {
    "guard": { "cases": 10, "passRate": 0.2, "ci95": { "lower": 0.06, "upper": 0.51 } },
    "discipline": { "cases": 4, "passRate": 0, "ci95": { "lower": 0, "upper": 0.49 } }
  },
  "cases": [
    {
      "name": "error-recovery",
      "passRate": 1.0,
      "passAtK": 1.0,
      "passExpK": 1.0,
      "ci95": { "lower": 0.72, "upper": 1.0 },
      "avgScore": 4.9,
      "status": "pass"
    }
  ]
}
```

## 环境变量

所有配置从 `.env` 读取，CLI 不硬编码任何模型或 URL。

| 变量 | 用途 | 默认值 |
|------|------|--------|
| `LLM_API_KEY` | LLM 代理 API key | (必填) |
| `LLM_BASE_URL` | LLM 代理 base URL | (必填) |
| `MODEL_TASK_EXECUTION` | subagent 执行模型 | `x-ai/grok-4.1-fast-non-reasoning` |
| `MODEL_PROMPT_EXECUTION` | prompt 执行模型 | `z-ai/glm-5-turbo` |
| `MODEL_CONTROLLER` | Judge / 控制器模型 | `anthropic/claude-sonnet-4.6` |
| `PORT` | Agent-Forge 服务端口 | `8001` |
| `FORGE_API_URL` | Agent-Forge API 地址 | `http://localhost:$PORT` |
| `LANGFUSE_*` | Langfuse 配置（unit 模式需要） | — |

## 设计原则

1. **Grade outcomes, not paths** — 优先检查结果而非执行路径，只在系统纪律（如 skill-before-tool）上约束路径
2. **pass@k + pass^k** — 区分"能力不足"和"不够稳定"
3. **Capability vs Regression** — 能力评测允许低通过率提供改进信号，回归评测必须 100%
4. **环境隔离** — 每次 run 独立 session，run 之间无共享状态
5. **统计显著性** — Wilson CI 量化可信度，Fisher test 量化 A/B 差异
6. **零 mock** — 对真实系统测试，不伪造工具返回值
7. **Judge 允许不确定** — `score: 0` 表示信息不足以判断

## 当前测试覆盖

47 个 case 覆盖以下维度：

| 维度 | Unit | Trace | 测什么 |
|------|------|-------|--------|
| Prompt 生成质量 | 7 | — | 角色/场景/分镜/运镜 prompt 的英文质量 |
| 9:16 竖屏合规 | 4 | — | 生成的 prompt 是否指定竖屏构图 |
| JSON 格式稳定性 | 2 | — | outputSchema 校验 + 自动重试 |
| Langfuse 编译 | 3 | — | 模板变量替换正确性 |
| 边界健壮性 | 2 | 3 | 极简/超长/空输入处理 |
| 安全合规 | 1 | 3 | 年龄标签、SQL 注入、危险操作 |
| Skill 纪律 | — | 6 | 使用工具前先读 skill |
| 意图识别 | — | 6 | 查询 vs 生成、复合请求、混合语言 |
| Guard 防护 | — | 7 | 未初始化阻断、虚构工具、只读权限 |
| 集成链路 | — | 5 | Langfuse→subagent、多 skill 协同、批量生成 |
| 工具效率 | — | 1 | 简单任务不过度调用 |

## 典型工作流

### 1. 发现问题

```bash
forge-eval run trace --tag discipline --runs 10
# 发现 skill-before-tool 0% 通过率
```

### 2. 优化 prompt

```bash
# 快照当前文件
forge-eval diff create fix-skill-rule src/lib/agent/system-prompt.ts

# 修改 system prompt，强化 skill 约束...
# (编辑文件)

# 保存 diff
forge-eval diff save fix-skill-rule
```

### 3. 验证效果

```bash
# 重跑同样的测试
forge-eval run trace --tag discipline --runs 10

# 对比修复前后
forge-eval compare 2026-04-09T15-42-10-trace 2026-04-10T10-00-00-trace
```

### 4. 升级为回归守护

```bash
# 通过率稳定后，升级为 regression
forge-eval promote skill-before-tool

# 以后每次改动都跑 regression 确保不退化
forge-eval run regression
```
