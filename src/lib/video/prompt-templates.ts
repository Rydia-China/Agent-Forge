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
  /* ---- Image generation wrappers ---- */
  /* Style words come exclusively from StylePreset DB (looked up by name). */
  /* These templates receive {{style}}/{{stylePrompt}} as a variable, never hardcode style. */

  /** Portrait generation: style + demographics → final prompt. */
  "common__portrait__image": "{{stylePrompt}}, demographics: {{demographics}}",

  /** Scene generation: style + visual prompt → final prompt. */
  "common__gen_scenery_shot__image": "{{style}},{{scenePrompt}}",

  /** Costume update: re-render character with new outfit description. */
  "common__update_profile__image": "用 {{appearance_desc}} 修改原本的人物立绘",

  /* ---- Scene grid & HD (consistent scene generation) ---- */

  /** Scene grid: generate a unified grid image for parent + all sub-locations. */
  "common__gen_scene_grid__image":
    "{{style}}\n" +
    "请生成一张 {{gridSize}} 宫格图片，每格比例16:9，所有格子风格必须严格统一。\n" +
    "请在每格底部标注场景名称：\n" +
    "{{gridSlots}}",

  /** Scene HD: enlarge a sub-scene using parent grid image as reference. */
  "common__gen_scene_hd__image":
    "参考图 1 生成 16:9 的场景图：{{style}}，" +
    "将【{{sceneName}}】的场景图放大并添加电影级细节，画面中没有任何文字和人物。",

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
