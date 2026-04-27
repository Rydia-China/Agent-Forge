/**
 * Asset generation related type definitions
 */

export interface StylePreset {
  stylePrompt: string;
  styleRefUrl: string | null;
}

export interface AnalyzedSubLocation {
  id: string;
  name: string;
  visualPrompt: string;
}

export interface AnalyzedLocation {
  id: string;
  name: string;
  visualPrompt: string;
  mode: "single" | "grid";
  realSubs: AnalyzedSubLocation[];
  gridSize: number;
}

export interface GenerateAndPersistImageInput {
  scopeType: string;
  scopeId: string;
  key: string;
  category: string;
  prompt: string;
  title: string;
  refUrls?: string[];
  model?: string;
}

export interface GenerateAndPersistImageResult {
  url: string;
  version: number;
}

export interface ExecuteVideoShotResult {
  status: string;
  key: string;
  keyResourceId: string;
  version: number;
  videoUrl: string;
  referenceImageCount: number;
  prompt: string;
}
