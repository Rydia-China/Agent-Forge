import { buildSystemPrompt } from './src/lib/agent/system-prompt';
import { initMcp } from './src/lib/mcp/init';
import { registry } from './src/lib/mcp/registry';

async function main() {
  console.log('=== Initializing MCP ===');
  await initMcp();
  
  console.log('\n=== Registered Providers ===');
  const providers = registry.listProviders();
  console.log(`Total providers: ${providers.length}`);
  providers.forEach(p => console.log(`  - ${p.name}`));
  
  console.log('\n=== All Tools ===');
  const allTools = await registry.listAllTools();
  console.log(`Total tools: ${allTools.length}`);
  allTools.forEach(t => console.log(`  - ${t.name}`));
  
  console.log('\n=== System Prompt ===');
  const systemPrompt = await buildSystemPrompt();
  console.log(systemPrompt);
  
  console.log('\n=== System Prompt with Skills ===');
  const systemPromptWithSkills = await buildSystemPrompt(['video-mgr']);
  console.log(systemPromptWithSkills);
}

main().catch(console.error);
