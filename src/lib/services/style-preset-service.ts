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
  await prisma.stylePreset.delete({ where: { id } });
}
