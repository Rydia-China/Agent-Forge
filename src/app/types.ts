/* ------------------------------------------------------------------ */
/*  Shared types for Agent Forge UI                                    */
/* ------------------------------------------------------------------ */

/* ---- Sessions ---- */

export type SessionSummary = {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
};

/* ---- Skills ---- */

export type SkillSummary = {
  name: string;
  description: string;
  tags: string[];
  productionVersion: number;
};

export type SkillDetail = {
  name: string;
  description: string;
  content: string;
  tags: string[];
  metadata: unknown;
  version: number;
  productionVersion: number;
};

export type SkillVersionSummary = {
  version: number;
  description: string;
  isProduction: boolean;
  createdAt: string;
};

/* ---- MCPs ---- */

export type McpSummary = {
  name: string;
  description: string | null;
  enabled: boolean;
  productionVersion: number;
  createdAt: string;
  updatedAt: string;
};

export type McpDetail = {
  name: string;
  description: string | null;
  code: string;
  enabled: boolean;
  config: unknown;
  version: number;
  productionVersion: number;
};

export type McpVersionSummary = {
  version: number;
  description: string | null;
  isProduction: boolean;
  createdAt: string;
};

export type BuiltinMcpSummary = {
  name: string;
  available: boolean;
  active: boolean;
};

/* ---- Resources ---- */

export type ResourceSelection =
  | { type: "skill"; name: string }
  | { type: "mcp"; name: string };

/* ---- Chat / Agent ---- */

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  images?: string[];
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

export type KeyResourceItem = {
  id: string;
  mediaType: string;
  url?: string | null;
  data?: unknown;
  title?: string | null;
};

export type SessionDetail = {
  id: string;
  title: string | null;
  messages: ChatMessage[];
  keyResources?: KeyResourceItem[];
};

export type UploadRequestPayload = {
  uploadId: string;
  endpoint: string;
  method: "PUT" | "POST";
  headers?: Record<string, string>;
  fields?: Record<string, string>;
  fileFieldName: string;
  accept?: string;
  purpose?: string;
  maxSizeMB?: number;
  bodyTemplate?: Record<string, string>;
  timeout?: number;
};
