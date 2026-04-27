import { registry } from '../registry';
import * as chatSessionService from '@/lib/services/chat-session-service';
import { z } from 'zod';

const ListSessionsParams = z.object({
  userName: z.string().optional(),
});

const GetSessionParams = z.object({
  sessionId: z.string().min(1),
});

const DeleteSessionParams = z.object({
  sessionId: z.string().min(1),
});

registry.register({
  name: 'chat:list-sessions',
  description: 'List all chat sessions',
  schema: ListSessionsParams,
  handler: async (args) => {
    const params = args as { userName?: string };
    const sessions = await chatSessionService.listSessions(params.userName);
    console.log(JSON.stringify(sessions, null, 2));
  },
});

registry.register({
  name: 'chat:get-session',
  description: 'Get a chat session with messages',
  schema: GetSessionParams,
  handler: async (args) => {
    const params = args as { sessionId: string };
    const session = await chatSessionService.getSession(params.sessionId);
    console.log(JSON.stringify(session, null, 2));
  },
});

registry.register({
  name: 'chat:delete-session',
  description: 'Delete a chat session',
  schema: DeleteSessionParams,
  handler: async (args) => {
    const params = args as { sessionId: string };
    await chatSessionService.deleteSession(params.sessionId);
    console.log('Session deleted successfully');
  },
});
