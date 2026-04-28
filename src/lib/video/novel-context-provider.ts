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
        const generated = group.items.filter(item => item.url).length;
        const pending = group.items.length - generated;

        lines.push("");
        lines.push(`### ${group.category} (${generated}/${group.items.length} 已生成)`);

        // Show up to 20 items per category to avoid context bloat
        const itemsToShow = group.items.slice(0, 20);
        for (const item of itemsToShow) {
          const status = item.url ? "✓" : "✗";
          lines.push(`- ${status} ${item.key} — ${item.title || item.key}`);
        }

        if (group.items.length > 20) {
          lines.push(`... 还有 ${group.items.length - 20} 项（使用 video_workflow__get_status 查看完整列表）`);
        }

        if (pending > 0) {
          lines.push(`⚠ ${pending} 项待生成`);
        }
      }
    } else {
      lines.push("");
      lines.push("## ⚠ 未初始化");
      lines.push("当前小说尚无任何小说级资源。请引导用户初始化角色立绘和关键场景。");
    }

    return lines.join("\n");
  }
}
