/**
 * Workflow orchestration related type definitions
 */

export interface InitWorkflowResult {
  scriptId: string;
  scriptKey: string;
  scriptName: string;
  missingCharacters: string[];
  characters: string[];
  costumes: Record<string, string>;
  nextStep: string;
}

export interface GetStatusResult {
  identity: {
    novelId: string;
    scriptId?: string;
    scriptKey?: string;
  };
  resources: Array<{
    key: string;
    mediaType: string;
    url: string | null;
    data?: unknown;
    version: number;
    title: string | null;
    category: string | null;
  }>;
  progress: {
    portraits: { done: number; total: number };
    scenes: { done: number; total: number };
    costumes: { done: number; total: number };
    videos: { done: number; total: number };
  };
  runningTasks: Array<{
    id: string;
    status: string;
    instruction: string;
  }>;
}
