import { AsyncLocalStorage } from "node:async_hooks";

interface RequestContext {
  userName?: string;
  sessionId?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function getCurrentUserName(): string | undefined {
  return requestContext.getStore()?.userName;
}

export function getCurrentSessionId(): string | undefined {
  return requestContext.getStore()?.sessionId;
}
