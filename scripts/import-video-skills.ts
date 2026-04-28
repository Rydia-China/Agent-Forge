#!/usr/bin/env tsx
/**
 * Deprecated: video skills are production data stored in DB/OSS.
 *
 * Do not import Agent-Forge video skills from local files. Runtime agents do not
 * have a filesystem, and file-based ClaudeCode workflow sources can overwrite the
 * DB/OSS production skills with instructions that cannot run in Agent-Forge.
 *
 * Update production skills through skillService.updateSkill, the skills:update
 * CLI command, or the admin API so getSkill() reads the new DB/OSS version.
 */
console.error("scripts/import-video-skills.ts is deprecated.");
console.error("Video skills must be updated in DB/OSS, not imported from local files.");
console.error("Use `pnpm cli skills:update '{...}'` or an admin/API flow that calls skillService.updateSkill.");
process.exit(1);
