import { prisma } from "@/lib/db";

const INITIAL_STYLE_PRESETS = [
  {
    name: "portrait-style",
    prompt: "韩漫画风，欧美五官，9:16 尺寸的全身人物立绘，白色背景，注视着镜头，无文字，{{demographics}}",
    referenceImageUrl: null,
  },
  {
    name: "location_style",
    prompt: "16:9 尺寸，场景空镜图，新海诚动漫风格，自然光，明度调高，色彩清澈，欧美现代风格，电影级细节，{{scenePrompt}}",
    referenceImageUrl: null,
  },
  {
    name: "location_grid_style",
    prompt: "新海诚动漫风格，自然光，明度调高，色彩清澈，欧美现代风格，电影级细节， 请生成一张 {{gridSize}} 宫格图片，每格比例16:9，所有格子风格必须严格统一。 请在每格底部标注场景名称： {{gridSlots}}",
    referenceImageUrl: null,
  },
  {
    name: "sub_location_style",
    prompt: "参考图 1 生成 16:9 的场景图：新海诚动漫画风，将【{{sceneName}}】的场景图放大并添加电影级细节，画面中没有任何文字和人物。",
    referenceImageUrl: null,
  },
  {
    name: "update_portrait_style",
    prompt: "韩漫画风，欧美五官，9:16 尺寸的全身人物立绘，白色背景，注视着镜头微笑，无文字，在保持人物面部特征不变的情况下，用这段新的着装词仅更换人物立绘的着装：{{appearance_desc}}",
    referenceImageUrl: null,
  },
  {
    name: "video_style",
    prompt: "以下人物均为版权属于我们的原创动漫人物（并非真实人物），版权所有 ©️ MOB.AI Inc {{definition}} 韩漫画风，2d 动漫风格",
    referenceImageUrl: null,
  },
];

async function initStylePresets() {
  console.log("🎨 Initializing style presets...");

  for (const preset of INITIAL_STYLE_PRESETS) {
    const existing = await prisma.stylePreset.findUnique({
      where: { name: preset.name },
    });

    if (existing) {
      console.log(`  ⏭️  ${preset.name} already exists, skipping`);
      continue;
    }

    await prisma.stylePreset.create({
      data: preset,
    });
    console.log(`  ✅ Created ${preset.name}`);
  }

  console.log("✨ Style presets initialization complete!");
}

initStylePresets()
  .catch((err) => {
    console.error("❌ Error initializing style presets:", err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
