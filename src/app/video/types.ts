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

/* ---- Resource types (backed by KeyResource, single source) ---- */

export interface ResourceItem {
  id: string;              // KeyResource ID — use directly for detail drawer
  key: string;
  category: string;
  mediaType: string;
  title: string | null;
  url: string | null;
  data: unknown;
  prompt: string | null;   // from current KeyResourceVersion
  currentVersion: number;  // 0 = pending, >0 = generated
}

export interface CategoryGroup {
  category: string;
  items: ResourceItem[];
}

export interface ResourceData {
  categories: CategoryGroup[];
}

export interface VideoContext {
  novelId: string;
  scriptId: string;
  scriptKey: string;
}
