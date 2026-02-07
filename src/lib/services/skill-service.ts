import { z } from "zod";
import { prisma } from "@/lib/db";
import type { Prisma, Skill, SkillVersion } from "@/generated/prisma";
import matter from "gray-matter";
import {
  listBuiltinSkills,
  getBuiltinSkill,
  type BuiltinSkill,
} from "@/lib/skills/builtins";

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
  description: z.string(),
  content: z.string(),
  tags: z.array(z.string()).optional(),
  metadata: z.unknown().optional(),
  promote: z.boolean().optional().default(true),
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

export const SkillSetProductionParams = z.object({
  name: z.string().min(1),
  version: z.number().int().positive(),
});

export const SkillVersionParams = z.object({
  name: z.string().min(1),
  version: z.number().int().positive(),
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

export function toSkillMd(skill: { name: string; description: string; content: string; metadata: Prisma.JsonValue | null }): string {
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

export interface SkillSummary {
  name: string;
  description: string;
  tags: string[];
  productionVersion: number;
}

export async function listSkills(tag?: string): Promise<SkillSummary[]> {
  const skills = await prisma.skill.findMany({
    where: tag ? { tags: { has: tag } } : undefined,
    include: { versions: { orderBy: { version: "desc" as const }, take: 1 } },
    orderBy: { name: "asc" },
  });

  const dbSkills: SkillSummary[] = skills
    .filter((s) => s.versions.length > 0)
    .map((s) => {
      // Use production version's description; fall back to latest
      const prodVer = s.versions.find((v) => v.version === s.productionVersion) ?? s.versions[0]!;
      return {
        name: s.name,
        description: prodVer.description,
        tags: s.tags,
        productionVersion: s.productionVersion,
      };
    });

  // Merge: builtins take precedence over DB skills with the same name
  const builtinList = listBuiltinSkills()
    .filter((b) => !tag || b.tags.includes(tag))
    .map((b): SkillSummary => ({
      name: b.name,
      description: b.description,
      tags: [...b.tags],
      productionVersion: 0,
    }));
  const builtinNames = new Set(builtinList.map((b) => b.name));
  const userSkills = dbSkills.filter((s) => !builtinNames.has(s.name));

  return [...builtinList, ...userSkills].sort((a, b) => a.name.localeCompare(b.name));
}

export interface SkillDetail {
  name: string;
  description: string;
  content: string;
  tags: string[];
  metadata: Prisma.JsonValue | null;
  version: number;
  productionVersion: number;
}

/** Resolve a skill by name: builtins first, then DB production version. */
export async function getSkill(name: string): Promise<SkillDetail | null> {
  const builtin = getBuiltinSkill(name);
  if (builtin) return builtinToSkillShape(builtin);

  const skill = await prisma.skill.findUnique({ where: { name } });
  if (!skill) return null;

  const ver = await prisma.skillVersion.findUnique({
    where: { skillId_version: { skillId: skill.id, version: skill.productionVersion } },
  });
  if (!ver) return null;

  return {
    name: skill.name,
    description: ver.description,
    content: ver.content,
    tags: skill.tags,
    metadata: ver.metadata,
    version: ver.version,
    productionVersion: skill.productionVersion,
  };
}

function builtinToSkillShape(b: BuiltinSkill): SkillDetail {
  return {
    name: b.name,
    description: b.description,
    content: b.content,
    tags: [...b.tags],
    metadata: null,
    version: 0,
    productionVersion: 0,
  };
}

export interface SkillCreateResult {
  skill: Skill;
  version: SkillVersion;
}

export async function createSkill(
  params: z.infer<typeof SkillCreateParams>,
): Promise<SkillCreateResult> {
  const skill = await prisma.skill.create({
    data: {
      name: params.name,
      tags: params.tags,
      productionVersion: 1,
      versions: {
        create: {
          version: 1,
          description: params.description,
          content: params.content,
          metadata: params.metadata as Prisma.InputJsonValue ?? undefined,
        },
      },
    },
    include: { versions: true },
  });
  return { skill, version: skill.versions[0]! };
}

export interface SkillUpdateResult {
  skill: Skill;
  version: SkillVersion;
}

/** Push a new version. Defaults to auto-promote. */
export async function updateSkill(
  params: z.infer<typeof SkillUpdateParams>,
): Promise<SkillUpdateResult> {
  const found = await prisma.skill.findUnique({
    where: { name: params.name },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });
  if (!found) throw new Error(`Skill "${params.name}" not found`);

  const nextVersion = (found.versions[0]?.version ?? 0) + 1;

  const newVer = await prisma.skillVersion.create({
    data: {
      skillId: found.id,
      version: nextVersion,
      description: params.description,
      content: params.content,
      metadata: params.metadata as Prisma.InputJsonValue ?? undefined,
    },
  });

  let updated: Skill = found;
  if (params.promote) {
    updated = await prisma.skill.update({
      where: { id: found.id },
      data: {
        productionVersion: nextVersion,
        ...(params.tags !== undefined ? { tags: params.tags } : {}),
      },
    });
  } else if (params.tags !== undefined) {
    updated = await prisma.skill.update({
      where: { id: found.id },
      data: { tags: params.tags },
    });
  }

  return { skill: updated, version: newVer };
}

export async function deleteSkill(name: string): Promise<void> {
  await prisma.skill.delete({ where: { name } });
}

/** Import from SKILL.md. Creates if new, pushes new version if exists. */
export async function importSkill(
  params: z.infer<typeof SkillImportParams>,
): Promise<SkillCreateResult | SkillUpdateResult> {
  const parsed = parseSkillMd(params.skillMd);
  if (!parsed.name) throw new Error("SKILL.md missing 'name' in frontmatter");

  const existing = await prisma.skill.findUnique({ where: { name: parsed.name } });
  if (!existing) {
    return createSkill({
      name: parsed.name,
      description: parsed.description,
      content: parsed.content,
      tags: params.tags ?? [],
      metadata: parsed.metadata ?? undefined,
    });
  }

  return updateSkill({
    name: parsed.name,
    description: parsed.description,
    content: parsed.content,
    tags: params.tags,
    metadata: parsed.metadata ?? undefined,
    promote: true,
  });
}

export async function exportSkill(name: string): Promise<string | null> {
  const skill = await getSkill(name);
  if (!skill) return null;
  return toSkillMd(skill);
}

/* ------------------------------------------------------------------ */
/*  Version management                                                */
/* ------------------------------------------------------------------ */

export interface SkillVersionSummary {
  version: number;
  description: string;
  isProduction: boolean;
  createdAt: Date;
}

export async function listSkillVersions(name: string): Promise<SkillVersionSummary[]> {
  const skill = await prisma.skill.findUnique({ where: { name } });
  if (!skill) throw new Error(`Skill "${name}" not found`);

  const versions = await prisma.skillVersion.findMany({
    where: { skillId: skill.id },
    orderBy: { version: "desc" },
    select: { version: true, description: true, createdAt: true },
  });

  return versions.map((v) => ({
    version: v.version,
    description: v.description,
    isProduction: v.version === skill.productionVersion,
    createdAt: v.createdAt,
  }));
}

export async function getSkillVersion(name: string, version: number): Promise<SkillDetail | null> {
  const skill = await prisma.skill.findUnique({ where: { name } });
  if (!skill) return null;

  const ver = await prisma.skillVersion.findUnique({
    where: { skillId_version: { skillId: skill.id, version } },
  });
  if (!ver) return null;

  return {
    name: skill.name,
    description: ver.description,
    content: ver.content,
    tags: skill.tags,
    metadata: ver.metadata,
    version: ver.version,
    productionVersion: skill.productionVersion,
  };
}

export async function setSkillProduction(name: string, version: number): Promise<Skill> {
  const skill = await prisma.skill.findUnique({ where: { name } });
  if (!skill) throw new Error(`Skill "${name}" not found`);

  const ver = await prisma.skillVersion.findUnique({
    where: { skillId_version: { skillId: skill.id, version } },
  });
  if (!ver) throw new Error(`Skill "${name}" has no version ${version}`);

  return prisma.skill.update({
    where: { id: skill.id },
    data: { productionVersion: version },
  });
}
