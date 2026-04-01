/**
 * VideoContextProvider — lightweight context for video workflow LLM sessions.
 *
 * Injects:
 *   1. novel_id / script_id / script_key — canonical identity (always present)
 *   2. init_workflow result — workflow guidance (only after successful init)
 *
 * When init_result is absent but domain_resources already exist for the
 * script, the workflow has progressed (the dynamic MCP wrote resources
 * but didn't persist init_result). In that case we tell the LLM to
 * continue rather than blocking with a "not initialized" warning.
 */

import type { ContextProvider } from "@/lib/agent/context-provider";
import {
  getInitResult,
  getEpisodeStatus,
} from "@/lib/services/video-workflow-service";
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
      const epStatus = await getEpisodeStatus(scriptId);

      if (epStatus === "has_resources") {
        // Workflow produced data but init_result wasn't persisted — safe to continue
        lines.push("");
        lines.push("## Workflow Active (init_result 缺失)");
        lines.push("domain_resources 已存在，工作流已有产出数据，可以继续工作。");
        lines.push("如需查看当前进度，请使用 get_workflow_status 或查询 domain_resources。");
      } else {
        lines.push("");
        lines.push("## ⚠ Workflow NOT initialized");
        lines.push("init_workflow 尚未成功执行，当前 EP 缺少结构化数据（人物、场景等）。");
        lines.push("请告知用户：工作流初始化失败，需要重新上传 EP 或手动触发初始化后才能继续。");
        lines.push("在初始化完成前，不要调用任何 generate_image / generate_video 等工具。");
      }
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
