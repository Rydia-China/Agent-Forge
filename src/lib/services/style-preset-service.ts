import { prisma } from "@/lib/db";
import type { StylePreset } from "@/generated/prisma";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface CreateStylePresetInput {
  name: string;
  prompt: string;
  referenceImageUrl?: string;
}

export interface UpdateStylePresetInput {
  name?: string;
  prompt?: string;
  referenceImageUrl?: string | null;
}

/** Built-in style preset names that cannot be renamed or deleted. */
export const BUILTIN_STYLE_NAMES = new Set([
  "location_style",
  "location_grid_style",
  "sub_location_style",
  "portrait-style",
  "update_portrait_style",
  "video_style",
]);

/* ------------------------------------------------------------------ */
/*  CRUD                                                               */
/* ------------------------------------------------------------------ */

export async function list(): Promise<StylePreset[]> {
  return prisma.stylePreset.findMany({ orderBy: { createdAt: "asc" } });
}

export async function getById(id: string): Promise<StylePreset | null> {
  return prisma.stylePreset.findUnique({ where: { id } });
}

export async function getByName(name: string): Promise<StylePreset | null> {
  return prisma.stylePreset.findUnique({ where: { name } });
}

export async function create(input: CreateStylePresetInput): Promise<StylePreset> {
  return prisma.stylePreset.create({
    data: {
      name: input.name,
      prompt: input.prompt,
      referenceImageUrl: input.referenceImageUrl ?? null,
    },
  });
}

export async function update(
  id: string,
  input: UpdateStylePresetInput,
): Promise<StylePreset> {
  // Protect built-in preset names from being renamed
  if (input.name !== undefined) {
    const existing = await prisma.stylePreset.findUnique({ where: { id } });
    if (existing && BUILTIN_STYLE_NAMES.has(existing.name) && input.name !== existing.name) {
      throw new Error(`Cannot rename built-in style preset "${existing.name}"`);
    }
  }
  return prisma.stylePreset.update({
    where: { id },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.prompt !== undefined && { prompt: input.prompt }),
      ...(input.referenceImageUrl !== undefined && { referenceImageUrl: input.referenceImageUrl }),
    },
  });
}

export async function remove(id: string): Promise<void> {
  const existing = await prisma.stylePreset.findUnique({ where: { id } });
  if (existing && BUILTIN_STYLE_NAMES.has(existing.name)) {
    throw new Error(`Cannot delete built-in style preset "${existing.name}"`);
  }
  await prisma.stylePreset.delete({ where: { id } });
}
