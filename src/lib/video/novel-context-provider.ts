/**
 * NovelContextProvider — context for novel-level resource management.
 *
 * Injects novel identity plus current novel-scope resource statistics.
 * Used only by the personalized /video novel resource agent.
 */

import type { ContextProvider } from "@/lib/agent/context-provider";
import { listResourcesByScope } from "@/lib/services/key-resource-listing";

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

export interface NovelContextConfig {
  novelId: string;
}

/* ------------------------------------------------------------------ */
/*  Provider implementation                                            */
/* ------------------------------------------------------------------ */

export class NovelContextProvider implements ContextProvider {
  constructor(private readonly config: NovelContextConfig) {}

  async build(): Promise<string> {
    const { novelId } = this.config;

    const lines: string[] = [
      "# Novel Resource Management Context",
      `novel_id: ${novelId}`,
      "",
      "## Scope",
      "当前为小说级资源管理，用于初始化和管理整个小说的共享资源：",
      "- 角色信息和初始立绘 (characters)",
      "- 场景位置和场景图片 (scene_locations)",
      "",
      "这些资源将被所有 EP 共享复用。",
    ];

    const categories = await listResourcesByScope("novel", novelId);

    if (categories.length > 0) {
      lines.push("");
      lines.push("## 已有小说级资源");
      for (const group of categories) {
        lines.push(`- ${group.category}: ${group.items.length} 项`);
      }
    } else {
      lines.push("");
      lines.push("## ⚠ 未初始化");
      lines.push("当前小说尚无任何小说级资源。请引导用户初始化角色立绘和关键场景。");
    }

    return lines.join("\n");
  }
}
