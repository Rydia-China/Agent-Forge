/**
 * VideoContextProvider — lightweight context for video workflow LLM sessions.
 *
 * Injects:
 *   1. novel_id / script_id / script_key — canonical identity
 *   2. Episode structured data — characters, character_outfits, scene_locations
 *
 * init_result now stores the full episode output JSON from the script upload.
 */

import type { ContextProvider } from "@/lib/agent/context-provider";
import {
  getEpisodeOutput,
  getEpisodeStatus,
} from "@/lib/services/video-workflow-service";

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

    const epOutput = await getEpisodeOutput(scriptId);

    const lines: string[] = [
      "# Video Workflow Context",
      `novel_id: ${novelId}`,
      `script_id: ${scriptId}`,
      `script_key: ${scriptKey}`,
    ];

    if (!epOutput) {
      const epStatus = await getEpisodeStatus(scriptId);

      if (epStatus === "has_resources") {
        lines.push("");
        lines.push("## Workflow Active");
        lines.push("domain_resources 已存在，工作流已有产出数据，可以继续工作。");
      } else {
        lines.push("");
        lines.push("## ⚠ No episode data");
        lines.push("当前 EP 缺少结构化数据，请重新上传小说 JSON。");
      }
      return lines.join("\n");
    }

    // Inject structured data for the LLM
    lines.push("");
    lines.push(`## Episode: ${String(epOutput.episode_title ?? scriptKey)}`);

    const characters = epOutput.characters as string[] | undefined;
    if (characters?.length) {
      lines.push(`characters: ${characters.join(", ")}`);
    }

    const outfits = epOutput.character_outfits as Record<string, string> | undefined;
    if (outfits && Object.keys(outfits).length > 0) {
      lines.push("");
      lines.push("### Character Outfits");
      for (const [name, desc] of Object.entries(outfits)) {
        lines.push(`- **${name}**: ${desc}`);
      }
    }

    const locations = epOutput.scene_locations as Record<string, Record<string, unknown>> | undefined;
    if (locations && Object.keys(locations).length > 0) {
      lines.push("");
      lines.push("### Scene Locations");
      for (const [name, loc] of Object.entries(locations)) {
        const prompt = loc.visual_prompt as string | undefined;
        lines.push(`- **${name}**: ${prompt ?? "(no visual prompt)"}`);
      }
    }

    return lines.join("\n");
  }
}
