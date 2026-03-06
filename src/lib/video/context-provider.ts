/**
 * VideoContextProvider — lightweight context for video workflow LLM sessions.
 *
 * Injects:
 *   1. novel_id / script_id / script_key — canonical identity (always present)
 *   2. init_workflow result — workflow guidance (only after successful init)
 *
 * If init_result is absent the workflow is NOT ready; context explicitly
 * tells the LLM to inform the user instead of attempting tool calls.
 */

import type { ContextProvider } from "@/lib/agent/context-provider";
import { getInitResult } from "@/lib/services/video-workflow-service";
import type { InitWorkflowResult } from "@/lib/services/video-workflow-service";

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

export interface VideoContextConfig {
  novelId: string;
  scriptId: string;
  scriptKey: string;
}

/* ------------------------------------------------------------------ */
/*  Provider implementation                                            */
/* ------------------------------------------------------------------ */

export class VideoContextProvider implements ContextProvider {
  constructor(private readonly config: VideoContextConfig) {}

  async build(): Promise<string> {
    const { novelId, scriptId, scriptKey } = this.config;

    const initResult: InitWorkflowResult | null =
      await getInitResult(novelId, scriptKey);

    const lines: string[] = [
      "# Video Workflow Context",
      `novel_id: ${novelId}`,
      `script_id: ${scriptId}`,
      `script_key: ${scriptKey}`,
    ];

    if (!initResult) {
      lines.push("");
      lines.push("## ⚠ Workflow NOT initialized");
      lines.push("init_workflow 尚未成功执行，当前 EP 缺少结构化数据（人物、场景等）。");
      lines.push("请告知用户：工作流初始化失败，需要重新上传 EP 或手动触发初始化后才能继续。");
      lines.push("在初始化完成前，不要调用任何 generate_image / generate_video 等工具。");
      return lines.join("\n");
    }

    lines.push("");
    lines.push("## Init Workflow Result");
    lines.push(`script_name: ${initResult.scriptName}`);
    lines.push(`next_step: ${initResult.nextStep}`);
    if (initResult.missingCharacters?.length) {
      lines.push(`missing_characters: ${initResult.missingCharacters.join(", ")}`);
    }

    return lines.join("\n");
  }
}
