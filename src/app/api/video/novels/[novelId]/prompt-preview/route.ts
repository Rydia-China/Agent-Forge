import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { compileTemplate } from "@/lib/mcp/static/langfuse-helpers";
import { analyzeLocations } from "@/lib/services/video-asset-generation-service";

export interface CharacterPreview {
  name: string;
  gender: string | null;
  age: string | null;
  appearance: string | null;
  personality: string | null;
  socialStatus: string | null;
  compiledPrompt: string | null;
  portraitUrl: string | null;
}

export interface ScenePreview {
  name: string;
  visualPrompt: string | null;
  description: string | null;
  compiledPrompt: string | null;
  mode: "single" | "grid" | "hd";
  imageUrl: string | null;
  parentName: string | null;
}

export interface PromptPreviewData {
  characters: CharacterPreview[];
  scenes: ScenePreview[];
}

/** GET /api/video/novels/[novelId]/prompt-preview */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ novelId: string }> },
) {
  const { novelId } = await params;

  try {
    const novel = await prisma.novel.findUnique({
      where: { id: novelId },
      select: { characterArcs: true, locationBible: true },
    });

    if (!novel) {
      return NextResponse.json({ error: "Novel not found" }, { status: 404 });
    }

    const characterArcs = (novel.characterArcs as Array<Record<string, unknown>>) ?? [];
    const locationBible = (novel.locationBible as Array<Record<string, unknown>>) ?? [];

    // Fetch style presets
    const portraitStyle = await prisma.stylePreset.findUnique({ where: { name: "portrait-style" } });
    const locationStyle = await prisma.stylePreset.findUnique({ where: { name: "location_style" } });
    const locationGridStyle = await prisma.stylePreset.findUnique({ where: { name: "location_grid_style" } });
    const subLocationStyle = await prisma.stylePreset.findUnique({ where: { name: "sub_location_style" } });

    // Fetch portrait URLs
    const portraitResources = await prisma.keyResource.findMany({
      where: { scopeType: "novel", scopeId: novelId, category: "角色立绘" },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    });
    const portraitUrlByTitle = new Map<string, string | null>();
    for (const r of portraitResources) {
      if (r.title) portraitUrlByTitle.set(r.title, r.versions[0]?.url ?? null);
    }

    // Fetch scene URLs
    const sceneResources = await prisma.keyResource.findMany({
      where: { scopeType: "novel", scopeId: novelId, category: "场景" },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    });
    const sceneUrlByTitle = new Map<string, string | null>();
    for (const r of sceneResources) {
      if (r.title) sceneUrlByTitle.set(r.title, r.versions[0]?.url ?? null);
    }

    // Build character previews
    const characters: CharacterPreview[] = characterArcs.map((arc) => {
      const name = String(arc.name ?? "");
      const gender = arc.gender ? String(arc.gender) : null;
      const age = arc.age ? String(arc.age) : null;
      const appearance = arc.appearance ? String(arc.appearance) : null;
      const personality = arc.personality ? String(arc.personality) : null;
      const socialStatus = arc.socialStatus ?? arc.social_status;
      const socialStatusStr = socialStatus ? String(socialStatus) : null;

      // Compile prompt using portrait-style template
      let compiledPrompt: string | null = null;
      if (portraitStyle && appearance) {
        compiledPrompt = compileTemplate(portraitStyle.prompt, {
          demographics: appearance,
        });
      }

      return {
        name,
        gender,
        age,
        appearance,
        personality,
        socialStatus: socialStatusStr,
        compiledPrompt,
        portraitUrl: portraitUrlByTitle.get(name) ?? null,
      };
    });

    // Build scene previews using analyzeLocations for accurate mode detection
    const analyzed = analyzeLocations(locationBible);
    const scenes: ScenePreview[] = [];

    for (const loc of analyzed) {
      const name = loc.name;
      const visualPrompt = loc.visualPrompt || null;
      const description = null; // Not available in analyzed structure
      const mode = loc.mode;

      // Compile prompt based on mode
      let compiledPrompt: string | null = null;
      if (visualPrompt) {
        if (mode === "grid" && locationGridStyle) {
          // For grid mode, build gridSlots from realSubs
          const slots: string[] = [`【格 1】${loc.name}：${loc.visualPrompt}`];
          loc.realSubs.forEach((sub, i) => {
            slots.push(`【格 ${i + 2}】${sub.name}：${sub.visualPrompt}`);
          });

          compiledPrompt = compileTemplate(locationGridStyle.prompt, {
            gridSize: String(loc.gridSize),
            gridSlots: slots.join("\n"),
          });
        } else if (locationStyle) {
          compiledPrompt = compileTemplate(locationStyle.prompt, {
            scenePrompt: visualPrompt,
          });
        }
      }

      scenes.push({
        name,
        visualPrompt,
        description,
        compiledPrompt,
        mode,
        imageUrl: sceneUrlByTitle.get(name) ?? sceneUrlByTitle.get(`${name} (grid)`) ?? null,
        parentName: null,
      });

      // Add sub-locations
      for (const sub of loc.realSubs) {
        const subName = sub.name;
        const subVisualPrompt = sub.visualPrompt || null;

        // Compile sub-location prompt
        let subCompiledPrompt: string | null = null;
        if (subLocationStyle && subVisualPrompt) {
          subCompiledPrompt = compileTemplate(subLocationStyle.prompt, {
            sceneName: subName,
          });
        }

        scenes.push({
          name: subName,
          visualPrompt: subVisualPrompt,
          description: null,
          compiledPrompt: subCompiledPrompt,
          mode: "single",
          imageUrl: sceneUrlByTitle.get(subName) ?? null,
          parentName: name,
        });
      }
    }

    const preview: PromptPreviewData = { characters, scenes };
    return NextResponse.json(preview);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to build prompt preview";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
