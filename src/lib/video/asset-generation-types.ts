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
  keyResourceId: string;
  category: string;
  title: string;
  prompt: string;
  stylePrompt: string;
  styleRefUrl: string | null;
  aspectRatio?: string;
}

export interface GenerateAndPersistImageResult {
  url: string;
  version: number;
}

export interface ExecuteVideoShotResult {
  url: string;
  version: number;
}
