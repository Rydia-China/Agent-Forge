/* ------------------------------------------------------------------ */
/*  Video workflow UI types                                            */
/* ------------------------------------------------------------------ */

export type EpStatus = "empty" | "uploaded" | "storyboarded" | "generating" | "done";

export interface EpisodeSummary {
  id: string;
  novelId: string;
  scriptKey: string;
  scriptName: string | null;
  status: EpStatus;
  createdAt: string;
}

export interface SceneDetail {
  id: string;
  sceneIndex: number;
  sceneTitle: string | null;
  sceneDesc: string | null;
  sceneImageUrl: string | null;
}

export interface ShotDetail {
  id: string;
  sceneIndex: number;
  shotIndex: string | null;
  shotType: string | null;
  definition: string | null;
  imagePrompt: string | null;
  videoPrompt: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
}

export interface StoryboardScene {
  scene: SceneDetail;
  shots: ShotDetail[];
}

export interface CharacterResource {
  id: string;
  characterName: string;
  physicalTraits: string | null;
  portraitUrl: string | null;
}

export interface CostumeResource {
  id: string;
  characterName: string;
  costumeImageUrl: string | null;
}

export interface ShotImageResource {
  id: string;
  sceneIndex: number;
  shotIndex: string | null;
  imageUrl: string;
}

export interface JsonResource {
  id: string;
  title: string;
  data: unknown;
}

export interface OtherImageResource {
  id: string;
  url: string;
  title: string | null;
}

export interface EpisodeResources {
  characters: CharacterResource[];
  costumes: CostumeResource[];
  sceneImages: SceneDetail[];
  shotImages: ShotImageResource[];
  jsonData: JsonResource[];
  otherImages: OtherImageResource[];
}

export interface VideoContext {
  novelId: string;
  novelName: string;
  scriptKey: string;
}
