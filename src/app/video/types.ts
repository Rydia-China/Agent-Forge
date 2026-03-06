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

/* ---- Generic domain resource types ---- */

export interface DomainResource {
  id: string;
  category: string;
  mediaType: string;
  title: string | null;
  url: string | null;
  data: unknown;
  keyResourceId: string | null;
  sortOrder: number;
}

export interface CategoryGroup {
  category: string;
  items: DomainResource[];
}

export interface DomainResources {
  categories: CategoryGroup[];
}

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
