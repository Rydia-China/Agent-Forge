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
import { getEpisodeWindow } from "@/lib/services/episode-service";
import { getInitResult } from "@/lib/services/video-workflow-orchestration-service";
import type { InitWorkflowResult } from "@/lib/video/workflow-types";

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
    const episodeWindow = await getEpisodeWindow(scriptId);

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
      lines.push("在初始化完成前，不要调用任何视频生成或资源生成工具。");
      return lines.join("\n");
    }

    lines.push("");
    lines.push("## Init Workflow Result");
    lines.push(`script_name: ${initResult.scriptName}`);
    lines.push(`next_step: ${initResult.nextStep}`);
    if (initResult.missingCharacters?.length) {
      lines.push(`missing_characters: ${initResult.missingCharacters.join(", ")}`);
    }

    if (episodeWindow.length) {
      lines.push("");
      lines.push("## Episode Source Window");
      lines.push("以下为当前 EP 及前后一集原文窗口。处理 EP2 时必须同时使用 EP1 / EP2 / EP3 原文理解情绪承接。");
      for (const episode of episodeWindow) {
        lines.push("");
        lines.push(`### ${episode.relation.toUpperCase()} ${episode.scriptKey}`);
        if (episode.scriptName) lines.push(`script_name: ${episode.scriptName}`);
        lines.push(`script_id: ${episode.scriptId}`);
        lines.push("script_content:");
        lines.push("```text");
        lines.push(episode.scriptContent ?? "");
        lines.push("```");
        if (episode.initResult !== null) {
          lines.push("init_result_json:");
          lines.push("```json");
          lines.push(JSON.stringify(episode.initResult, null, 2));
          lines.push("```");
        }
      }
    }

    return lines.join("\n");
  }
}
