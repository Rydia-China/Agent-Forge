import { registry } from '../registry';
import * as skillService from '@/lib/services/skill-service';

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
