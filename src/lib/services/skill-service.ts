import { z } from "zod";
import { prisma } from "@/lib/db";
import type { Prisma, Skill } from "@/generated/prisma";
import matter from "gray-matter";
import * as ossService from "@/lib/services/oss-service";

/* ------------------------------------------------------------------ */
/*  Zod schemas
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
/*  OSS helpers                                                       */
/* ------------------------------------------------------------------ */

function buildOssUrl(ossKey: string): string {
  const bucket = process.env.OSS_BUCKET!;
  const region = process.env.OSS_REGION!;
  return `https://${bucket}.oss-${region}.aliyuncs.com/${ossKey}`;
}

async function fetchSkillContentFromOss(ossKey: string): Promise<string> {
  const url = buildOssUrl(ossKey);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch skill from OSS: ${ossKey} (${response.status})`);
  }
  return response.text();
}

/* ------------------------------------------------------------------ */
/*  Service functions                                                 */
/* ------------------------------------------------------------------ */

export interface SkillSummary {
  name: string;
  description: string;
  tags: string[];
  version: number;
  isProduction: boolean;
}

export async function listSkills(tag?: string): Promise<SkillSummary[]> {
  const skills = await prisma.skill.findMany({
    where: {
      isProduction: true,
      ...(tag ? { tags: { has: tag } } : {}),
    },
    orderBy: { name: "asc" },
  });

  return skills.map((s) => ({
    name: s.name,
    description: s.description,
    tags: s.tags,
    version: s.version,
    isProduction: s.isProduction,
  }));
}

export interface SkillDetail {
  name: string;
  description: string;
  content: string;
  tags: string[];
  metadata: Prisma.JsonValue | null;
  version: number;
  isProduction: boolean;
}

/** Get production version of a skill by name. */
export async function getSkill(name: string): Promise<SkillDetail | null> {
  const skill = await prisma.skill.findFirst({
    where: { name, isProduction: true },
    orderBy: { updatedAt: "desc" }, // Last-Write-Wins
  });

  if (!skill) return null;

  // Fetch content from OSS
  const skillMd = await fetchSkillContentFromOss(skill.ossKey);
  const parsed = parseSkillMd(skillMd);

  return {
    name: skill.name,
    description: skill.description,
    content: parsed.content,
    tags: skill.tags,
    metadata: skill.metadata,
    version: skill.version,
    isProduction: skill.isProduction,
  };
}

export interface SkillCreateResult {
  skill: Skill;
}

export async function createSkill(
  params: z.infer<typeof SkillCreateParams>,
): Promise<SkillCreateResult> {
  // Check if skill already exists
  const existing = await prisma.skill.findFirst({
    where: { name: params.name },
  });
  if (existing) {
    throw new Error(`Skill "${params.name}" already exists. Use updateSkill to create a new version.`);
  }

  const version = 1;
  const ossKey = `public/skills/${params.name}/v${version}.md`;

  // Generate SKILL.md content
  const skillMd = toSkillMd({
    name: params.name,
    description: params.description,
    content: params.content,
    metadata: params.metadata as Prisma.JsonValue ?? null,
  });

  // 1. Upload to OSS first
  await ossService.uploadBuffer(
    Buffer.from(skillMd, "utf-8"),
    `${params.name}/v${version}.md`,
    "skills"
  );

  // 2. Write to DB
  const skill = await prisma.skill.create({
    data: {
      name: params.name,
      version,
      description: params.description,
      tags: params.tags,
      ossKey,
      isProduction: true,
      metadata: params.metadata as Prisma.InputJsonValue ?? undefined,
    },
  });

  return { skill };
}

export interface SkillUpdateResult {
  skill: Skill;
}

/** Push a new version. Defaults to auto-promote. */
export async function updateSkill(
  params: z.infer<typeof SkillUpdateParams>,
): Promise<SkillUpdateResult> {
  // Find latest version
  const latest = await prisma.skill.findFirst({
    where: { name: params.name },
    orderBy: { version: "desc" },
  });

  if (!latest) {
    throw new Error(`Skill "${params.name}" not found. Use createSkill to create it first.`);
  }

  const nextVersion = latest.version + 1;
  const ossKey = `public/skills/${params.name}/v${nextVersion}.md`;

  // Generate SKILL.md content
  const skillMd = toSkillMd({
    name: params.name,
    description: params.description,
    content: params.content,
    metadata: params.metadata as Prisma.JsonValue ?? null,
  });

  // 1. Upload to OSS first
  await ossService.uploadBuffer(
    Buffer.from(skillMd, "utf-8"),
    `${params.name}/v${nextVersion}.md`,
    "skills"
  );

  // 2. Write to DB
  const newSkill = await prisma.skill.create({
    data: {
      name: params.name,
      version: nextVersion,
      description: params.description,
      tags: params.tags ?? latest.tags,
      ossKey,
      isProduction: params.promote,
      metadata: params.metadata as Prisma.InputJsonValue ?? undefined,
    },
  });

  // 3. If promoting, unset old production version
  if (params.promote) {
    await prisma.skill.updateMany({
      where: {
        name: params.name,
        id: { not: newSkill.id },
        isProduction: true,
      },
      data: { isProduction: false },
    });
  }

  return { skill: newSkill };
}

export async function deleteSkill(name: string): Promise<void> {
  // Delete all versions of this skill
  await prisma.skill.deleteMany({ where: { name } });
  
  // Note: OSS files are not deleted (orphan files are harmless)
  // Can be cleaned up later with a separate cleanup script
}

/** Import from SKILL.md. Creates if new, pushes new version if exists. */
export async function importSkill(
  params: z.infer<typeof SkillImportParams>,
): Promise<SkillCreateResult | SkillUpdateResult> {
  const parsed = parseSkillMd(params.skillMd);
  if (!parsed.name) throw new Error("SKILL.md missing 'name' in frontmatter");

  const existing = await prisma.skill.findFirst({ where: { name: parsed.name } });
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
  const versions = await prisma.skill.findMany({
    where: { name },
    orderBy: { version: "desc" },
    select: { version: true, description: true, isProduction: true, createdAt: true },
  });

  return versions;
}

export async function getSkillVersion(name: string, version: number): Promise<SkillDetail | null> {
  const skill = await prisma.skill.findUnique({
    where: { name_version: { name, version } },
  });

  if (!skill) return null;

  // Fetch content from OSS
  const skillMd = await fetchSkillContentFromOss(skill.ossKey);
  const parsed = parseSkillMd(skillMd);

  return {
    name: skill.name,
    description: skill.description,
    content: parsed.content,
    tags: skill.tags,
    metadata: skill.metadata,
    version: skill.version,
    isProduction: skill.isProduction,
  };
}

export async function setSkillProduction(name: string, version: number): Promise<Skill> {
  const target = await prisma.skill.findUnique({
    where: { name_version: { name, version } },
  });

  if (!target) {
    throw new Error(`Skill "${name}" version ${version} not found`);
  }

  // Use transaction to ensure atomicity
  await prisma.$transaction([
    // Unset current production
    prisma.skill.updateMany({
      where: { name, isProduction: true },
      data: { isProduction: false },
    }),
    // Set new production
    prisma.skill.update({
      where: { id: target.id },
      data: { isProduction: true },
    }),
  ]);

  return prisma.skill.findUniqueOrThrow({ where: { id: target.id } });
}
