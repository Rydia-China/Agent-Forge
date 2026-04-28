import { registry } from '../registry';
import * as skillService from '@/lib/services/skill-service';
import { z } from 'zod';

const SkillAuditTermsParams = z.object({
  names: z.array(z.string().min(1)).min(1),
  terms: z.array(z.string().min(1)).min(1),
  caseSensitive: z.boolean().optional().default(true),
});

const SkillShowMatchesParams = z.object({
  name: z.string().min(1),
  terms: z.array(z.string().min(1)).min(1),
  contextLines: z.number().int().min(0).max(20).optional().default(3),
  caseSensitive: z.boolean().optional().default(true),
});

const SkillReplaceContentParams = z.object({
  name: z.string().min(1),
  replacements: z.array(z.object({
    search: z.string().min(1),
    replace: z.string(),
  })).min(1),
  requireAll: z.boolean().optional().default(true),
  dryRun: z.boolean().optional().default(false),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  promote: z.boolean().optional().default(true),
});

function countOccurrences(content: string, term: string, caseSensitive: boolean): number {
  const haystack = caseSensitive ? content : content.toLowerCase();
  const needle = caseSensitive ? term : term.toLowerCase();
  let count = 0;
  let index = 0;
  while (true) {
    const found = haystack.indexOf(needle, index);
    if (found === -1) return count;
    count++;
    index = found + needle.length;
  }
}

function includesTerm(line: string, terms: string[], caseSensitive: boolean): string[] {
  const haystack = caseSensitive ? line : line.toLowerCase();
  return terms.filter((term) => haystack.includes(caseSensitive ? term : term.toLowerCase()));
}

async function getRequiredSkill(name: string): Promise<skillService.SkillDetail> {
  const skill = await skillService.getSkill(name);
  if (!skill) {
    throw new Error(`Skill "${name}" not found`);
  }
  return skill;
}

registry.register({
  name: 'skills:list',
  description: 'List all skills',
  schema: skillService.SkillListParams,
  handler: async (args) => {
    const params = args as { tag?: string };
    const skills = await skillService.listSkills(params.tag);
    console.log(JSON.stringify(skills, null, 2));
  },
});

registry.register({
  name: 'skills:get',
  description: 'Get a skill by name',
  schema: skillService.SkillGetParams,
  handler: async (args) => {
    const params = args as { name: string };
    const skill = await skillService.getSkill(params.name);
    console.log(JSON.stringify(skill, null, 2));
  },
});

registry.register({
  name: 'skills:create',
  description: 'Create a new skill',
  schema: skillService.SkillCreateParams,
  handler: async (args) => {
    const params = args as { name: string; description: string; content: string; tags: string[]; metadata?: unknown };
    const result = await skillService.createSkill(params);
    console.log(JSON.stringify(result, null, 2));
  },
});

registry.register({
  name: 'skills:update',
  description: 'Update an existing skill',
  schema: skillService.SkillUpdateParams,
  handler: async (args) => {
    const params = args as { name: string; description: string; content: string; tags?: string[]; metadata?: unknown; promote: boolean };
    const result = await skillService.updateSkill(params);
    console.log(JSON.stringify(result, null, 2));
  },
});

registry.register({
  name: 'skills:delete',
  description: 'Delete a skill',
  schema: skillService.SkillDeleteParams,
  handler: async (args) => {
    const params = args as { name: string };
    await skillService.deleteSkill(params.name);
    console.log('Skill deleted successfully');
  },
});

registry.register({
  name: 'skills:import',
  description: 'Import a skill from SKILL.md format',
  schema: skillService.SkillImportParams,
  handler: async (args) => {
    const params = args as { skillMd: string; tags?: string[] };
    const result = await skillService.importSkill(params);
    console.log(JSON.stringify(result, null, 2));
  },
});

registry.register({
  name: 'skills:export',
  description: 'Export a skill to SKILL.md format',
  schema: skillService.SkillExportParams,
  handler: async (args) => {
    const params = args as { name: string };
    const skillMd = await skillService.exportSkill(params.name);
    console.log(skillMd);
  },
});

registry.register({
  name: 'skills:set-production',
  description: 'Set a specific version as production',
  schema: skillService.SkillSetProductionParams,
  handler: async (args) => {
    const params = args as { name: string; version: number };
    const skill = await skillService.setSkillProduction(params.name, params.version);
    console.log(JSON.stringify(skill, null, 2));
  },
});

registry.register({
  name: 'skills:list-versions',
  description: 'List all versions of a skill',
  schema: skillService.SkillGetParams,
  handler: async (args) => {
    const params = args as { name: string };
    const versions = await skillService.listSkillVersions(params.name);
    console.log(JSON.stringify(versions, null, 2));
  },
});

registry.register({
  name: 'skills:audit-terms',
  description: 'Count literal term occurrences in production skill content',
  schema: SkillAuditTermsParams,
  handler: async (args) => {
    const params = args as z.infer<typeof SkillAuditTermsParams>;
    const results = await Promise.all(params.names.map(async (name) => {
      const skill = await getRequiredSkill(name);
      const hits = Object.fromEntries(
        params.terms
          .map((term) => [term, countOccurrences(skill.content, term, params.caseSensitive)] as const)
          .filter(([, count]) => count > 0),
      );
      return {
        name: skill.name,
        version: skill.version,
        isProduction: skill.isProduction,
        hits,
      };
    }));
    console.log(JSON.stringify(results, null, 2));
  },
});

registry.register({
  name: 'skills:show-matches',
  description: 'Show line contexts for literal term matches in a production skill',
  schema: SkillShowMatchesParams,
  handler: async (args) => {
    const params = args as z.infer<typeof SkillShowMatchesParams>;
    const skill = await getRequiredSkill(params.name);
    const lines = skill.content.split(/\r?\n/);
    const matches = lines
      .map((line, index) => ({
        line: index + 1,
        terms: includesTerm(line, params.terms, params.caseSensitive),
      }))
      .filter((match) => match.terms.length > 0)
      .map((match) => {
        const start = Math.max(1, match.line - params.contextLines);
        const end = Math.min(lines.length, match.line + params.contextLines);
        return {
          line: match.line,
          terms: match.terms,
          context: lines.slice(start - 1, end).map((content, offset) => ({
            line: start + offset,
            content,
          })),
        };
      });
    console.log(JSON.stringify({
      name: skill.name,
      version: skill.version,
      isProduction: skill.isProduction,
      matches,
    }, null, 2));
  },
});

registry.register({
  name: 'skills:replace-content',
  description: 'Apply literal replacements to a production skill and optionally publish a new version',
  schema: SkillReplaceContentParams,
  handler: async (args) => {
    const params = args as z.infer<typeof SkillReplaceContentParams>;
    const skill = await getRequiredSkill(params.name);
    let content = skill.content;
    const applied = params.replacements.map((replacement) => {
      const count = countOccurrences(content, replacement.search, true);
      if (params.requireAll && count === 0) {
        throw new Error(`Search text not found in skill "${params.name}": ${replacement.search}`);
      }
      content = content.split(replacement.search).join(replacement.replace);
      return { search: replacement.search, count };
    });

    if (params.dryRun) {
      console.log(JSON.stringify({
        name: skill.name,
        version: skill.version,
        dryRun: true,
        applied,
        changed: content !== skill.content,
      }, null, 2));
      return;
    }

    const result = await skillService.updateSkill({
      name: skill.name,
      description: params.description ?? skill.description,
      content,
      tags: params.tags ?? skill.tags,
      metadata: skill.metadata ?? undefined,
      promote: params.promote,
    });
    console.log(JSON.stringify({
      skill: result.skill,
      applied,
    }, null, 2));
  },
});
