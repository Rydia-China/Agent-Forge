/**
 * NovelContextProvider — context for novel-level resource management.
 *
 * Injects:
 *   1. novel_id — canonical identity
 *   2. Available characters and scene_locations from domain_resources
 *
 * Used for novel-level operations: initializing character portraits,
 * scene images, and other novel-wide shared resources.
 */

import type { ContextProvider } from "@/lib/agent/context-provider";
import { getResourcesByScope } from "@/lib/domain/resource-service";

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

    // List existing novel-level resources
    const categories = await getResourcesByScope("novel", novelId);

    if (categories.length > 0) {
      lines.push("");
      lines.push("## 已有资源");
      for (const group of categories) {
        const count = group.items.length;
        lines.push(`- ${group.category}: ${count} 项`);
      }
    } else {
      lines.push("");
      lines.push("## ⚠ 未初始化");
      lines.push("当前小说尚无任何资源。请引导用户初始化角色和场景。");
    }

    return lines.join("\n");
  }
}
