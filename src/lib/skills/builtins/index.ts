import matter from "gray-matter";

/* ------------------------------------------------------------------ */
/*  Import raw SKILL.md strings — 新增 builtin 只需加一行 import       */
/* ------------------------------------------------------------------ */

import { raw as skillCreator } from "./skill-creator";
import { raw as dynamicMcpBuilder } from "./dynamic-mcp-builder";
import { raw as databaseOperator } from "./database-operator";
import { raw as apiBuilder } from "./api-builder";
import { raw as promptCompiler } from "./prompt-compiler";
import { raw as promptDelegator } from "./prompt-delegator";
import { raw as storageUploader } from "./storage-uploader";
import { raw as clientUploader } from "./client-uploader";
import { raw as forgeSync } from "./forge-sync";
import { raw as stylePreset } from "./style-preset";

const RAW_SKILLS: readonly string[] = [
  skillCreator,
  dynamicMcpBuilder,
  databaseOperator,
  apiBuilder,
  promptCompiler,
  promptDelegator,
  storageUploader,
  clientUploader,
  forgeSync,
  stylePreset,
];

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface BuiltinSkill {
  readonly name: string;
  readonly description: string;
  readonly content: string;
  readonly tags: readonly string[];
  readonly provider: string;
  readonly requiresMcps: readonly string[];
}

/* ------------------------------------------------------------------ */
/*  Parse once at module load                                         */
/* ------------------------------------------------------------------ */

function parse(raw: string): BuiltinSkill {
  const { data, content } = matter(raw);
  const name = String(data.name ?? "");
  if (!name) throw new Error("Built-in skill missing 'name' in frontmatter");
  const provider = String(data.provider ?? "");
  if (!provider) throw new Error(`Built-in skill "${name}" missing 'provider' in frontmatter`);
  return {
    name,
    description: String(data.description ?? ""),
    content: content.trim(),
    tags: Array.isArray(data.tags) ? (data.tags as string[]) : [],
    provider,
    requiresMcps: Array.isArray(data.requires_mcps) ? (data.requires_mcps as string[]) : [],
  };
}

/** All built-in skills, parsed and frozen. */
export const BUILTIN_SKILLS: readonly BuiltinSkill[] = RAW_SKILLS.map(parse);

/** name → BuiltinSkill lookup */
const byName = new Map<string, BuiltinSkill>(
  BUILTIN_SKILLS.map((s) => [s.name, s]),
);

export function getBuiltinSkill(name: string): BuiltinSkill | undefined {
  return byName.get(name);
}

export function listBuiltinSkills(): readonly BuiltinSkill[] {
  return BUILTIN_SKILLS;
}
