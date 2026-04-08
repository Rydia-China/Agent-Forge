# Prompt 处理流程说明

## 一、Prompt 编译机制

**StylePreset.prompt 就是完整的 prompt 模板。** 代码只提供数据变量做 `{{var}}` 替换，替换后直接就是最终 prompt。

代码中禁止硬编码任何 prompt 结构（风格词、指令语、copyright 等）。全部在 StylePreset DB 中维护。

## 三、画风词注入机制

所有画风词来源于 **StylePreset 数据库表**，通过 `styleName`（唯一名称）查找：

```
resolveStyle(styleName)
  → stylePresetService.getByName(name)
  → { prompt: string, referenceImageUrl: string | null }
```

- `prompt` 字段 = 画风描述词（注入到模板的 `{{style}}` / `{{stylePrompt}}` 变量）
- `referenceImageUrl` = 风格参考图 URL（作为 reference image 传入生图 API）

**默认画风名约定**（由 skill 声明，前端 hook 中有对应常量）：
- 角色立绘：`portrait-style`
- 场景图（单场景）：`location_style`
- 宫格图：`location_grid_style`
- 高清放大：`sub_location_style`

## 四、每个任务的详细执行流程

---

### 1. generate_portrait / update_portrait（角色立绘）

两个工具逻辑相同，但引用不同的 StylePreset：
- `generate_portrait` → `portrait-style`（初次创建）
- `update_portrait` → `update_portrait_style`（更新重绘）

**数据源**: `novels.character_arcs` → 匹配 `characterName` 的 `appearance` 字段

**StylePreset**: 按 `styleName` 查 DB（推荐 `portrait-style`）

**Langfuse 模板**: `common__portrait__image`

**编译变量**:
- `{{stylePrompt}}` ← StylePreset.prompt（画风词）
- `{{demographics}}` ← arc.appearance（外貌描述）

**最终 prompt 结构**: `{画风词}, demographics: {外貌描述}`

**参考图**: StylePreset.referenceImageUrl（如果有）+ 用户传入的 referenceUrls

---

### 2. generate_scene — single 模式（单场景图）

**数据源**: `novels.location_bible` → 匹配 `sceneName` 的 `visual_prompt` 字段（支持在 parent 和 sub_locations 中查找）

**StylePreset**: 按 `styleName` 查 DB（推荐 `location_style`）

**Langfuse 模板**: `common__gen_scenery_shot__image`

**编译变量**:
- `{{style}}` ← StylePreset.prompt（画风词）
- `{{scenePrompt}}` ← location.visual_prompt（场景视觉描述）

**最终 prompt 结构**: `{画风词},{场景视觉描述}`

**参考图**: StylePreset.referenceImageUrl + referenceUrls

---

### 3. generate_scene — grid 模式（宫格图）

**数据源**: `novels.location_bible` → `analyzeLocations()` 分析父场景 + 所有真实 sub_locations（id 与父级不同）

**StylePreset**: 按 `styleName` 查 DB（推荐 `location_grid_style`）

**Langfuse 模板**: `common__gen_scene_grid__image`

**编译变量**:
- `{{style}}` ← StylePreset.prompt（画风词）
- `{{gridSize}}` ← String(realSubs.length + 1)（宫格数 = 子场景数 + 1 个父场景）
- `{{gridSlots}}` ← 按以下格式拼接的字符串：
  ```
  【格 1】父场景名：父场景 visual_prompt
  【格 2】子场景1名：子场景1 visual_prompt
  【格 3】子场景2名：子场景2 visual_prompt
  ...
  ```

**最终 prompt 结构**:
```
{画风词}
请生成一张 {N} 宫格图片，每格比例16:9，所有格子风格必须严格统一。
请在每格底部标注场景名称：
{各格描述}
```

**参考图**: StylePreset.referenceImageUrl + referenceUrls

---

### 4. generate_scene — hd 模式（子场景高清放大）

**前置条件**: 父场景的 grid 图必须已经生成（从 KeyResource 查 `scene_{parentName}_grid` key，version > 0）

**数据源**: `analyzeLocations()` → 遍历所有 parent 找到包含 `sceneName` 的 sub

**StylePreset**: 按 `styleName` 查 DB（推荐 `sub_location_style`）

**Langfuse 模板**: `common__gen_scene_hd__image`

**编译变量**:
- `{{style}}` ← StylePreset.prompt（画风词）
- `{{sceneName}}` ← 子场景名（中文）

**最终 prompt 结构**: `参考图 1 生成 16:9 的场景图：{画风词}，将【{子场景名}】的场景图放大并添加电影级细节，画面中没有任何文字和人物。`

**参考图顺序**: 父场景 grid 图 URL（第一张）→ StylePreset.referenceImageUrl → referenceUrls

---

### 5. generate_costume（换装）

**数据源**: 当前集的 `novel_scripts.init_result` → `character_outfits[characterName]`（衣服描述文本）

**StylePreset**: 按 `styleName` 查 DB

**Langfuse 模板**: `common__update_profile__image`

**编译变量**:
- `{{stylePrompt}}` ← StylePreset.prompt（画风词）
- `{{appearance_desc}}` ← outfit 描述文本

**最终 prompt 结构**: `用 {衣服描述} 修改原本的人物立绘`

**参考图收集逻辑**（自动）:
1. StylePreset.referenceImageUrl（画风参考）
2. 自动查找该角色的 portrait 图（KeyResource key = `char_{name}_portrait`，novel scope）
3. 用户传入的 referenceUrls

> ⚠️ **注意**: 本地模板 `prompt-templates.ts` 中 `common__update_profile__image` 只含 `{{appearance_desc}}`，但 MCP 代码向 Langfuse 传了 `{{stylePrompt}}`。说明 Langfuse 远程模板应包含 `{{stylePrompt}}` 变量，与本地模板**内容不一致**。

---

### 6. generate_video — shotPrompt 模式（首选）

**数据源**: 调用方（subagent / video_prompt_generator）传入 `shotPrompt` + 已解析的 `referenceImageUrls`

**StylePreset**: 按 `styleName` 查 DB

**不使用 Langfuse 模板** — 直接字符串拼接

**prompt 拼接顺序**:
```
{copyright 声明}
{shotPrompt}
{StylePreset.prompt（画风词）}
```

**copyright 固定值**: `"以下人物均为版权属于我们的原创动漫人物（并非真实人物），版权所有 ©️ MOB.AI Inc"`

**参考图**: StylePreset.referenceImageUrl（unshift 到最前）+ 调用方传入的 referenceImageUrls

**视频模式判定**:
- 有 `sourceVideoUrls` → `multimodal`（续拍）
- 有 `sourceImageUrl` → `first_frame`（图生视频）
- 都没有 → `text_to_video`

---

### 7. generate_video — clipDescription 模式（legacy）

**数据源**: 调用方传入 `clipDescription`

**StylePreset**: 按 `styleName` 查 DB

**参考图自动收集**:
1. StylePreset.referenceImageUrl → `图1: 风格参考图 {url}`
2. 当前 novel 所有已生成**场景图**（category = 场景, version > 0）→ `图N: 场景「{title}」 {url}`
3. 当前 episode 所有已生成**换装图**（category = 换装, version > 0）→ `图N: 角色「{title}」 {url}`

**videoPrompt 拼接顺序**:
```
{copyright 声明}
{clipDescription}
{StylePreset.prompt（画风词）}
{referenceInfo（图1: ... 图2: ... 等）}
```

**Langfuse 模板**: `live2d__gen_scene__video`

**编译变量**:
- `{{videoPrompt}}` ← 上面拼好的完整 prompt

**实际效果**: 模板内容就是 `{{videoPrompt}}`（纯透传），等于没有额外模板处理。

---

### 8. generate_video — prompt override 模式

直接使用用户传入的 `prompt` 字段，**不走任何模板/画风/copyright 处理**。

---

### 9. extract_tail / concat_clips

这两个工具不涉及 prompt 处理：
- `extract_tail`: 纯视频剪辑（ffmpeg 截取尾部 N 秒），上传 OSS，不持久化 KeyResource
- `concat_clips`: 纯视频拼接（ffmpeg concat），持久化到 KeyResource

## 五、数据流总图

```
StylePreset DB ────────────────────────┐
  (name → prompt,            │
   referenceImageUrl)        │
                             ▼
character_arcs ────► ┌────────────┐    ┌─────────────────┐
location_bible ────► │  提取变量   │ ──►│ 直接字符串拼接  │ ──► final prompt
character_outfits ──►│  (DB 查询)  │    │ (无外部模板引擎) │
                     └────────────┘    └─────────────────┘
```

## 六、各 StylePreset 可用变量

- **portrait-style / update_portrait_style**: `{{demographics}}` — 角色外貌描述
- **location_style**: `{{name}}` `{{scenePrompt}}` — 场景名、场景视觉描述
- **location_grid_style**: `{{name}}` `{{gridSize}}` `{{gridSlots}}` — 场景名、宫格数、各格描述
- **sub_location_style**: `{{name}}` `{{sceneName}}` — 场景名
- **video_style**: `{{shotPrompt}}` `{{clipDescription}}` `{{referenceInfo}}` — 分镜描述/片段描述/参考图信息

## 七、调用入口

- **MCP Tool 执行**: `src/lib/mcp/static/video-workflow.ts` — 各 generate_* case 内联拼接
- **前端 Prompt Preview**: `src/lib/services/video-workflow-service.ts` → `getPromptPreview()`
- **REST API 编译**: `POST /api/prompts/:name/compile` — 仍可走 Langfuse（仅用于浏览，非生产路径）
