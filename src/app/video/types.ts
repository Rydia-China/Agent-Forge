/* ------------------------------------------------------------------ */
/*  Video workflow UI types                                            */
/* ------------------------------------------------------------------ */

export type EpStatus = "empty" | "uploaded" | "has_resources";

export interface EpisodeSummary {
  id: string;
  novelId: string;
  scriptKey: string;
  scriptName: string | null;
  status: EpStatus;
  createdAt: string;
}

/* ---- Versioned resource types ---- */

export interface ResourceItem {
  id: string;
  key: string;
  category: string;
  mediaType: string;
  title: string | null;
  url: string | null;
  data: unknown;
  prompt: string | null;
  currentVersion: number;
  keyResourceId?: string | null;
  sortOrder?: number;
}
export type DomainResource = ResourceItem;

export interface CategoryGroup {
  category: string;
  items: ResourceItem[];
}

export interface ResourceData {
  categories: CategoryGroup[];
}
export type DomainResources = ResourceData;

export interface VideoResourceData {
  key?: string;
  prompt?: string;
  sourceImageUrl?: string | null;
}

export interface VideoContext {
  novelId: string;
  scriptId: string;
  scriptKey: string;
}
