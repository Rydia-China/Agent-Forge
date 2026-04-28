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

/**
 * Video shot planning types
 */

export interface VideoShotAssets {
  images: string[];
  videos: string[];
}

export interface VideoShotPlan {
  shotId: string;
  duration: number;
  mode: string;
  scene: string;
  shotFunction: string;
  prevShotRecap: string;
  nextShotSetup: string;
  emotionArc: string;
  assets: VideoShotAssets;
  shotPrompt: string;
  definition: string;
  title: string;
}

export interface PlanVideoShotsResult {
  scriptId: string;
  episodeKey: string;
  shots: VideoShotPlan[];
  totalShots: number;
}

export interface ReviewResult {
  passed: boolean;
  issues: Array<{
    shotId: string;
    category: string;
    description: string;
    severity: "error" | "warning";
  }>;
  suggestions: string[];
}

export interface GenerateVideoShotsResult {
  scriptId: string;
  episodeKey: string;
  shots: Array<{
    shotId: string;
    status: "reviewed" | "failed";
    prompt: string;
    reviewIterations: number;
    keyResourceId?: string;
    error?: string;
  }>;
  totalIterations: number;
}
