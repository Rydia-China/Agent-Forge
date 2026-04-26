import matter from "gray-matter";

/* ------------------------------------------------------------------ */
/*  Import raw SKILL.md strings — 新增预置 skill 只需加一行 import    */
/* ------------------------------------------------------------------ */

import { raw as skillCreator } from "./skill-creator";
import { raw as businessDatabase } from "./business-database";
import { raw as videoMgr } from "./video-mgr";
import { raw as novelResourceMgr } from "./novel-resource-mgr";
import { raw as epVideoWorkflow } from "./ep-video-workflow";
import { raw as langfuse } from "./langfuse";
import { raw as subagent } from "./subagent";
import { raw as oss } from "./oss";
import { raw as upload } from "./upload";
import { raw as forgeSync } from "./forge-sync";

const RAW_SKILLS: readonly string[] = [
  skillCreator,
  businessDatabase,
  videoMgr,
  novelResourceMgr,
  epVideoWorkflow,
  langfuse,
  subagent,
  oss,
  upload,
  forgeSync,
];

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface PresetSkill {
  readonly name: string;
  readonly description: string;
  readonly content: string;
  readonly tags: readonly string[];
  readonly requiresMcps: readonly string[];
}

/* ------------------------------------------------------------------ */
/*  Parse once at module load                                         */
/* ------------------------------------------------------------------ */

function parse(raw: string): PresetSkill {
  const { data, content } = matter(raw);
  const name = String(data.name ?? "");
  if (!name) throw new Error("Preset skill missing 'name' in frontmatter");
  return {
    name,
    description: String(data.description ?? ""),
    content: content.trim(),
    tags: Array.isArray(data.tags) ? (data.tags as string[]) : [],
    requiresMcps: Array.isArray(data.requires_mcps) ? (data.requires_mcps as string[]) : [],
  };
}

/** All preset skills, parsed and frozen. */
const PRESET_SKILLS: readonly PresetSkill[] = RAW_SKILLS.map(parse);

export function listPresetSkills(): readonly PresetSkill[] {
  return PRESET_SKILLS;
}
