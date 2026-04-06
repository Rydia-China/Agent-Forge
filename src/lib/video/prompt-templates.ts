/**
 * Local prompt templates for the video workflow pipeline.
 *
 * Replaces the previous Langfuse dependency with built-in templates.
 * Templates are simple {{variable}} strings compiled at call time.
 *
 * Naming convention matches the old Langfuse names for traceability:
 *   {workflow}__{step}__{type}
 */

/* ------------------------------------------------------------------ */
/*  Template compilation                                               */
/* ------------------------------------------------------------------ */

/** Replace `{{key}}` placeholders with values from `variables`. */
export function compileTemplate(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    return key in variables ? variables[key]! : match;
  });
}

/* ------------------------------------------------------------------ */
/*  Built-in templates                                                 */
/* ------------------------------------------------------------------ */

/**
 * Registry of all prompt templates used by the video workflow.
 * Key = template name, value = raw template string with {{var}} placeholders.
 */
export const PROMPT_TEMPLATES: Record<string, string> = {
  /* ---- Style defaults (used when no styleId is provided) ---- */

  /** Default portrait style words. */
  "common__portrait_style__prompt":
    "高质量欧美漫画风格，漫画风格，美型赛璐璐，清爽线稿，欧美二次元脸型，" +
    "精致服饰细节，明亮通透配色，柔和光影，青春感，有设计感的服装，电影级服装，" +
    "9:16，full body，full body illustration，white background。" +
    "你需要生成一个严格符合年龄、身份、人物特征的人物立绘图：",

  /** Default scene style words. */
  "common__style__prompt":
    "参照图 1 的画风， 生成 16:9 的场景空镜图，LOL Arcane style，自然光，" +
    "明度调高，色彩清澈，欧美现代风格，取消所有蒸汽朋克的元素，不得出现任何人物。",

  /* ---- Image generation wrappers ---- */

  /** Portrait generation: style + demographics → final prompt. */
  "common__portrait__image": "{{stylePrompt}}, demographics: {{demographics}}",

  /** Scene generation: style + visual prompt → final prompt. */
  "common__gen_scenery_shot__image": "{{style}},{{scenePrompt}}",

  /** Costume update: re-render character with new outfit description. */
  "common__update_profile__image": "用 {{appearance_desc}} 修改原本的人物立绘",

  /* ---- Video generation wrapper ---- */

  /** Video generation: wraps the assembled video prompt. */
  "live2d__gen_scene__video": "{{videoPrompt}}",
};

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export type PromptName = keyof typeof PROMPT_TEMPLATES;

/**
 * Compile a named template with the given variables.
 * Throws if the template name is not found.
 */
export function compilePrompt(
  name: string,
  variables: Record<string, string> = {},
): string {
  const template = PROMPT_TEMPLATES[name];
  if (!template) {
    const available = Object.keys(PROMPT_TEMPLATES).join(", ");
    throw new Error(
      `Unknown prompt template "${name}". Available: ${available}`,
    );
  }
  return compileTemplate(template, variables);
}

/**
 * List all registered template names (for discovery by agents).
 */
export function listPromptTemplates(): Array<{
  name: string;
  template: string;
  variables: string[];
}> {
  return Object.entries(PROMPT_TEMPLATES).map(([name, template]) => {
    const vars: string[] = [];
    const re = /\{\{(\w+)\}\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(template)) !== null) {
      if (!vars.includes(m[1]!)) vars.push(m[1]!);
    }
    return { name, template, variables: vars };
  });
}
