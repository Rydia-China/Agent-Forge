import { z } from "zod";
import { prisma } from "@/lib/db";
import type { Prisma, Skill } from "@/generated/prisma";
import matter from "gray-matter";

/* ------------------------------------------------------------------ */
/*  Zod schemas — single source of truth for input validation         */
/* ------------------------------------------------------------------ */

export const SkillListParams = z.object({
  tag: z.string().optional(),
});

export const SkillGetParams = z.object({
  name: z.string().min(1),
});

export const SkillCreateParams = z.object({
  name: z.string().min(1),
  description: z.string(),
  content: z.string(),
  tags: z.array(z.string()).optional().default([]),
  metadata: z.unknown().optional(),
});

export const SkillUpdateParams = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  content: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.unknown().optional(),
});

export const SkillDeleteParams = z.object({
  name: z.string().min(1),
});

export const SkillImportParams = z.object({
  skillMd: z.string().min(1),
  tags: z.array(z.string()).optional(),
});

export const SkillExportParams = z.object({
  name: z.string().min(1),
});

/* ------------------------------------------------------------------ */
/*  SKILL.md parsing / formatting                                     */
/* ------------------------------------------------------------------ */

interface SkillMdFields {
  name: string;
  description: string;
  content: string;
  metadata: Prisma.InputJsonValue | null;
}

export function parseSkillMd(raw: string): SkillMdFields {
  const { data, content } = matter(raw);
  return {
    name: String(data.name ?? ""),
    description: String(data.description ?? ""),
    content: content.trim(),
    metadata: (data.metadata as Prisma.InputJsonValue) ?? null,
  };
}

export function toSkillMd(skill: Pick<Skill, "name" | "description" | "content" | "metadata">): string {
  const fm: Record<string, unknown> = {
    name: skill.name,
    description: skill.description,
  };
  if (skill.metadata) fm.metadata = skill.metadata;
  return matter.stringify(skill.content, fm);
}

/* ------------------------------------------------------------------ */
/*  Service functions                                                 */
/* ------------------------------------------------------------------ */

type SkillSummary = Pick<Skill, "name" | "description" | "tags">;

export async function listSkills(tag?: string): Promise<SkillSummary[]> {
  return prisma.skill.findMany({
    where: tag ? { tags: { has: tag } } : undefined,
    select: { name: true, description: true, tags: true },
    orderBy: { name: "asc" },
  });
}

export async function getSkill(name: string): Promise<Skill | null> {
  return prisma.skill.findUnique({ where: { name } });
}

export async function createSkill(
  params: z.infer<typeof SkillCreateParams>,
): Promise<Skill> {
  const data: Prisma.SkillCreateInput = {
    name: params.name,
    description: params.description,
    content: params.content,
    tags: params.tags,
    metadata: params.metadata as Prisma.InputJsonValue ?? undefined,
  };
  return prisma.skill.create({ data });
}

export async function updateSkill(
  params: z.infer<typeof SkillUpdateParams>,
): Promise<Skill> {
  const data: Prisma.SkillUpdateInput = {};
  if (params.description !== undefined) data.description = params.description;
  if (params.content !== undefined) data.content = params.content;
  if (params.tags !== undefined) data.tags = params.tags;
  if (params.metadata !== undefined) data.metadata = params.metadata as Prisma.InputJsonValue;
  return prisma.skill.update({ where: { name: params.name }, data });
}

export async function deleteSkill(name: string): Promise<void> {
  await prisma.skill.delete({ where: { name } });
}

export async function importSkill(
  params: z.infer<typeof SkillImportParams>,
): Promise<Skill> {
  const parsed = parseSkillMd(params.skillMd);
  if (!parsed.name) throw new Error("SKILL.md missing 'name' in frontmatter");

  const createData: Prisma.SkillCreateInput = {
    name: parsed.name,
    description: parsed.description,
    content: parsed.content,
    metadata: parsed.metadata ?? undefined,
    tags: params.tags ?? [],
  };
  const updateData: Prisma.SkillUpdateInput = {
    description: parsed.description,
    content: parsed.content,
    metadata: parsed.metadata ?? undefined,
    ...(params.tags ? { tags: params.tags } : {}),
  };
  return prisma.skill.upsert({
    where: { name: parsed.name },
    create: createData,
    update: updateData,
  });
}

export async function exportSkill(name: string): Promise<string | null> {
  const skill = await prisma.skill.findUnique({ where: { name } });
  if (!skill) return null;
  return toSkillMd(skill);
}
