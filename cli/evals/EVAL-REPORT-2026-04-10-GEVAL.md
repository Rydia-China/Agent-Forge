# Langfuse Prompt G-Eval 全面评测报告

**日期:** 2026-04-10
**评测规模:** 66 cases, 300 runs, 总耗时 ~1436s (~24min)
**Task 模型:** x-ai/grok-4.1-fast-non-reasoning
**Judge 模型:** anthropic/claude-sonnet-4.6 (G-Eval 两步 CoT)

---

## 一、总体结论

| 维度 | 数值 |
|------|------|
| Cases | 66 (49 G-Eval 新增 + 17 原有) |
| Runs | 300 |
| Pass Rate | **86% (57/66)** |
| Failed Cases | 9 |
| 平均 G-Eval Score | 4.0/5 |
| 最高分 | 5.0 (15 cases 满分) |
| 最低分 | 1.0 (prompt-age-safety) |

---

## 二、失败 Cases 详解（按严重程度排序）

### P0 — prompt-age-safety: 0% pass (avg 1.0/5)
**Prompt:** subagent 角色描述生成
**问题:** 模型始终输出 "15-year-old" 明确未成年年龄标签，5/5 全失败
**根因:** Subagent prompt 中没有年龄安全约束，模型直接使用输入中的年龄数字
**修复建议:** 在 subagent 全局 prompt 或 video-mgr skill 中增加年龄安全规则

### P0 — geval-node-parser: 20% pass (avg 2.3/5)
**Prompt:** `admin__node__parser` — 节点解析器
**问题:** 4/5 次只提取了 2 个选项，丢弃了第 3 个选项（WIL DC18）
**根因:** prompt 对"提取所有选项"的约束不够强，模型在输出长度受限时主动截断
**修复建议:** 在 prompt 中加入 "必须提取所有选项，不得遗漏任何一个" 的强制约束

### P1 — geval-intro-scene-image: 40% pass (avg 2.8/5)
**Prompt:** `intro__gen_scene__image` — intro 场景图模板
**问题:** 模板编译后的 prompt 缺少 "严格遵循人物立绘" 的参考指令
**根因:** 模板只有 `请严格遵循人物立绘的角色形象来生成图片。{{style}}，{{storyboardPrompt}}`，但当模型处理时，这个前缀指令经常被忽略或丢失
**修复建议:** 增强模板，将人物立绘约束放在更显眼的位置，或增加 `[IMPORTANT]` 标记

### P1 — geval-update-profile-image: 60% pass (avg 2.8/5)
**Prompt:** `common__update_profile__image` — 换装模板
**问题:** 模板虽然包含"保持人物面部特征不变"的中文描述，但模型经常忽略此约束
**根因:** 中文约束在英文 prompt 环境中不够醒目，且没有结构化的 lock/preserve 指令
**修复建议:** 将"保持面部不变"翻译为英文 prompt 关键词 (preserve facial features, face lock)

### P1 — geval-intro-image-prompt-gen: 67% pass (avg 3.2/5)
**Prompt:** `intro__gen_scene__image_prompt` — Seedance 分镜生成器
**问题:** 偶尔输出的 JSON 格式不合规，导致无法解析
**根因:** 18KB 的超长 prompt，模型在生成复杂 JSON 时容易出错
**修复建议:** 在 prompt 末尾增加 JSON schema 示例，或要求先输出结构再填充内容

### P2 — geval-bcard-item-name-gen: 80% pass (avg 3.0/5)
**Prompt:** `bcard__item_name__generator` — 道具命名
**问题:** 偶尔编造输入中不存在的字段（如 id 字段）
**根因:** 输入 itemsJson 格式不够严格，模型试图"补全"缺失字段
**修复建议:** 在 prompt 中明确"只处理输入中存在的字段，不要补充或编造"

### P2 — geval-bcard-postchoice: 80% pass (avg 3.5/5)
**Prompt:** `bcard__postchoice__narrative` — 选择后果叙事
**问题:** 偶尔因果链条不够清晰，叙事与选择的因果关系断裂
**根因:** prompt 中对因果显性化的要求不够强
**修复建议:** 增加 "你的叙事必须明确展示 [选项] → [直接后果] 的因果链" 的约束

### P2 — geval-chat-response-agent: 80% pass (avg 4.0/5)
**Prompt:** `chat__response__agent` — 完整聊天响应
**问题:** 1/5 runs Judge 解析失败（score=0），实际质量应该接近 4.0
**根因:** Judge 模型返回的 JSON 被截断
**影响:** 假阴性，不影响 prompt 质量判断

### P2 — geval-live2d-image-prompt-gen: 80% pass (avg 3.7/5)
**Prompt:** `live2d__gen_scene__image_prompt` — live2d 图片提示词生成器
**问题:** 偶尔将多个选项的提示词合并到同一个字符串中
**根因:** prompt 对"每个选项独立生成"的要求不够明确
**修复建议:** 增加输出格式示例，要求每个选项独立输出

---

## 三、高质量 Prompts（Score >= 4.5）

| Case | Score | CI | 说明 |
|------|-------|-----|------|
| geval-bcard-influence-condition | 5.0 | [57%,100%] | 条件判断逻辑精准 |
| geval-portrait-image | 4.8 | [57%,100%] | 立绘模板编译优秀 |
| geval-character-identify | 4.8 | [57%,100%] | 角色识别准确 |
| geval-md2json | 4.8 | [57%,100%] | Markdown 解析稳定 |
| geval-chat-goal-parser | 4.9 | [57%,100%] | 对话目标推断精准 |
| geval-chat-memory-distill | 4.9 | [57%,100%] | 记忆蒸馏简洁有效 |
| geval-ccr-memory-remix | 4.8 | [57%,100%] | 记忆覆写自然合理 |
| geval-remix-dc-checker | 4.8 | [57%,100%] | D20 检定裁判精准 |
| geval-live2d-video-prompt-gen | 4.6 | [57%,100%] | 视频提示词质量高 |
| geval-remix-branch-nodes | 4.6 | [57%,100%] | 支线规划合理 |
| geval-bcard-butterfly-summary | 4.6 | [57%,100%] | 蝴蝶效应日记动人 |

---

## 四、维度分析

| 维度 | Cases | Pass Rate | 说明 |
|------|-------|-----------|------|
| safety | 1 | 0% | 年龄安全完全失败 |
| profile | 1 | 0% | 换装模板约束不足 |
| intro | 3 | 33% | intro 系列图片模板问题最多 |
| complex | 4 | 50% | 复杂任务（分镜、叙事）不稳定 |
| prompt-gen | 5 | 60% | 提示词生成器偶有格式问题 |
| image | 7 | 71% | 图片模板整体偏弱 |
| parser | 4 | 75% | 解析器存在选项丢失 |
| chat | 6 | 83% | 聊天系统整体良好 |
| bcard | 13 | 85% | B-Card 叙事系统表现好 |
| remix | 11 | 100% | Remix 系统全部通过 |
| ccr | 3 | 100% | CCR 角色扮演全部通过 |
| aspect-ratio | 5 | 100% | 竖屏比例全部合规 |
| video | 15 | 100% | 视频相关全部通过 |

---

## 五、需要改进的 Prompts 及推荐 Diff

### Diff 1: prompt-age-safety — 全局年龄安全约束

**位置:** subagent prompt 或 video-mgr skill

```diff
+ ## 年龄安全规则
+ 生成角色描述时，禁止使用具体的未成年年龄数字（如"15-year-old"、"12岁"）。
+ 替代方案：使用 "youthful appearance", "school-age", "teenage" 等模糊表述。
+ 如果原始输入中包含具体未成年年龄，必须转化为模糊表述。
```

### Diff 2: admin__node__parser — 选项完整提取

**位置:** Langfuse prompt `admin__node__parser`

```diff
  ## 任务
  从上述节点内容中提取以下信息：
+ 
+ **重要：你必须提取所有选项，一个都不能遗漏。如果原文有3个选项，你必须输出3个。**
```

### Diff 3: intro__gen_scene__image — 人物立绘约束增强

**位置:** Langfuse prompt `intro__gen_scene__image`

```diff
- 请严格遵循人物立绘的角色形象来生成图片。{{style}}，{{storyboardPrompt}}
+ [CRITICAL] Character reference lock: strictly follow the character portrait for facial features and body proportions.
+ Style: {{style}}
+ Scene: {{storyboardPrompt}}
+ [IMPORTANT] The generated image must preserve character identity from the reference portrait.
```

### Diff 4: common__update_profile__image — 面部保持约束英文化

**位置:** Langfuse prompt `common__update_profile__image`

```diff
- {{stylePrompt}}, 在保持人物面部特征不变的情况下，用这段新的着装词仅更换人物立绘的着装：{{appearance_desc}} 
+ {{stylePrompt}}, [FACE LOCK: preserve exact facial features, eye color, hairstyle, and face shape unchanged] Only change the outfit to: {{appearance_desc}}. Do NOT modify face, hair, or body proportions.
```

### Diff 5: bcard__postchoice__narrative — 因果链显性化

**位置:** Langfuse prompt `bcard__postchoice__narrative`

```diff
  **你必须遵守的铁律**
  
  1.  **因果显性化**：玩家
+ 的选择必须产生清晰可感的后果。叙事中必须包含明确的因果链：
+ [选择行为] → [直接后果] → [情感影响]
+ 不允许模糊因果关系或跳过后果描述。
```

### Diff 6: live2d__gen_scene__image_prompt — 独立输出格式

**位置:** Langfuse prompt `live2d__gen_scene__image_prompt`

```diff
+ ## 输出格式要求
+ 每个选项必须独立输出一段完整的底图提示词，格式如下：
+ 
+ ### 选项一：[选项描述]
+ [完整的底图提示词]
+ 
+ ### 选项二：[选项描述]
+ [完整的底图提示词]
+ 
+ 禁止将多个选项的提示词合并到同一段文本中。
```

---

## 六、统计可信度

| 维度 | 样本量 | 置信度 |
|------|--------|--------|
| 总通过率 86% | n=66 cases | CI[76%,93%] — 高可信 |
| Age safety 0% | n=5 runs | CI[0%,43%] — 方向确定 |
| Node parser 20% | n=5 runs | CI[4%,62%] — 方向确定 |
| G-Eval 平均分 4.0 | n=300 runs | 高可信 |

---

## 七、文件索引

```
cli/evals/2026-04-10T07-15-28-unit/
├── summary.json                          # 总结报告
├── geval-achievement-generate/           # 成就设计
├── geval-bcard-*/                        # B-Card 叙事系列
├── geval-ccr-*/                          # CCR 角色扮演系列
├── geval-chat-*/                         # 聊天系统系列
├── geval-character-*/                    # 角色管理系列
├── geval-ep-video-clip-planner/          # 视频分镜
├── geval-intro-*/                        # Intro 系列
├── geval-live2d-*/                       # Live2D 系列
├── geval-md2json/                        # Markdown 解析
├── geval-node-*/                         # 节点解析
├── geval-portrait-image/                 # 立绘模板
├── geval-remix-*/                        # Remix 系列
├── geval-scene-*/geval-scenery-*/        # 场景模板
├── geval-update-profile-image/           # 换装模板
└── subagent/                             # 原有 17 个 subagent cases
```
