import { registry } from '../registry';
import * as subagentService from '@/lib/services/subagent-service';
import { z } from 'zod';

const GetSubagentParams = z.object({
  subagentId: z.string().min(1),
});

const CancelSubagentParams = z.object({
  subagentId: z.string().min(1),
});

registry.register({
  name: 'subagent:get',
  description: 'Get subagent details',
  schema: GetSubagentParams,
  handler: async (args) => {
    const params = args as { subagentId: string };
    const subagent = await subagentService.getSubAgent(params.subagentId);
    console.log(JSON.stringify(subagent, null, 2));
  },
});

registry.register({
  name: 'subagent:cancel',
  description: 'Cancel a running subagent',
  schema: CancelSubagentParams,
  handler: async (args) => {
    const params = args as { subagentId: string };
    const cancelled = await subagentService.cancelSubAgent(params.subagentId);
    console.log(JSON.stringify({ cancelled }, null, 2));
  },
});
