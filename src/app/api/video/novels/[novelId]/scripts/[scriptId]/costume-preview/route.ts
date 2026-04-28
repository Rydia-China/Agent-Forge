import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { compileTemplate } from "@/lib/mcp/static/langfuse-helpers";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ novelId: string; scriptId: string }> }
) {
  try {
    const { novelId, scriptId } = await params;

    const script = await prisma.novelScript.findUnique({
      where: { id: scriptId },
      select: {
        id: true,
        novelId: true,
        initResult: true,
        costumes: true,
      },
    });

    if (!script) {
      return NextResponse.json({ error: "Script not found" }, { status: 404 });
    }

    if (script.novelId !== novelId) {
      return NextResponse.json({ error: "Script does not belong to this novel" }, { status: 400 });
    }

    const ir = script.initResult as Record<string, unknown> | null;
    const outfits = (ir?.character_outfits ?? script.costumes) as Record<string, string> | undefined;

    if (!outfits || Object.keys(outfits).length === 0) {
      return NextResponse.json({ costumes: [] });
    }

    const stylePreset = await prisma.stylePreset.findUnique({
      where: { name: "update_portrait_style" },
    });

    if (!stylePreset) {
      return NextResponse.json({ error: "update_portrait_style preset not found" }, { status: 404 });
    }

    const costumes = Object.entries(outfits).map(([characterName, outfitDesc]) => {
      const compiledPrompt = compileTemplate(stylePreset.prompt, {
        appearance_desc: outfitDesc,
      });

      const portraitKey = `char_${characterName.toLowerCase().replace(/\s+/g, "_")}_portrait`;

      return {
        characterName,
        outfitDesc,
        compiledPrompt,
        portraitKey,
      };
    });

    const portraitKeys = costumes.map((c) => c.portraitKey);
    const portraits = await prisma.keyResource.findMany({
      where: {
        scopeType: "novel",
        scopeId: novelId,
        key: { in: portraitKeys },
      },
      include: {
        versions: {
          orderBy: { version: "desc" },
          take: 1,
        },
      },
    });

    const portraitMap = new Map(
      portraits.map((p) => [p.key, p.versions[0]?.url ?? null])
    );

    const result = costumes.map((c) => ({
      ...c,
      portraitUrl: portraitMap.get(c.portraitKey) ?? null,
    }));

    return NextResponse.json({ costumes: result });
  } catch (error) {
    console.error("Error fetching costume preview:", error);
    return NextResponse.json(
      { error: "Failed to fetch costume preview" },
      { status: 500 }
    );
  }
}
