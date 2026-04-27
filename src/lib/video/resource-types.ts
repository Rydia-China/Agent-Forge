/**
 * Resource-related type definitions
 */

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

export interface ResourceDiffItem {
  key: string;
  category: string;
  title: string;
  scopeType: string;
  scopeId: string;
  status: "generated" | "pending";
  isNew: boolean;
}

export interface StaleResourceItem {
  key: string;
  category: string;
  title: string;
  scopeType: string;
  scopeId: string;
}

export interface ResourceDiff {
  expected: ResourceDiffItem[];
  stale: StaleResourceItem[];
}

// Internal types used by resource service
export interface ExpectedResourceMeta {
  key: string;
  category: string;
  title: string;
  scopeType: string;
  scopeId: string;
}

export interface ExistingKeyResourceMeta {
  key: string;
  category: string | null;
  title: string | null;
  scopeType: string;
  scopeId: string;
  currentVersion: number;
}
