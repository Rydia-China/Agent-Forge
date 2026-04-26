import { z } from "zod";
import * as skillService from "./skill-service";

/* ------------------------------------------------------------------ */
/*  Hub configuration                                                  */
/* ------------------------------------------------------------------ */

const DEFAULT_HUB_URL = "https://agent.mob-ai.cn/";

function getHubUrl(): string {
  return (process.env.FORGE_HUB_URL ?? DEFAULT_HUB_URL).replace(/\/+$/, "");
}

function isHub(): boolean {
  return process.env.FORGE_IS_HUB === "true";
}

/** Normalise URL for comparison (strip trailing slash + protocol). */
function normaliseUrl(url: string): string {
  return url.replace(/\/+$/, "").replace(/^https?:\/\//, "");
}

/** Reject if the target/source URL points to self (hub self-protection). */
function rejectSelfSync(remoteUrl: string): void {
  if (!isHub()) return;
  const self = normaliseUrl(getHubUrl());
  const remote = normaliseUrl(remoteUrl);
  if (self === remote) {
    throw new Error("Hub cannot sync with itself. Provide a different remote URL.");
  }
}

/* ------------------------------------------------------------------ */
/*  Zod schemas                                                        */
/* ------------------------------------------------------------------ */

export const SyncPushParams = z.object({
  type: z.literal("skill"),
  name: z.string().min(1),
  targetUrl: z.string().url().optional(),
});

export const SyncPullParams = z.object({
  type: z.literal("skill"),
  name: z.string().min(1),
  sourceUrl: z.string().url().optional(),
});

export const SyncDiscoverParams = z.object({
  type: z.literal("skill"),
  tag: z.string().optional(),
  sourceUrl: z.string().url().optional(),
});

export const SyncDiffParams = z.object({
  type: z.literal("skill"),
  names: z.array(z.string()).optional(),
  tag: z.string().optional(),
  sourceUrl: z.string().url().optional(),
});


/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface SyncPushResult {
  action: "created" | "updated";
  type: "skill";
  name: string;
  targetUrl: string;
}

export interface SyncPullResult {
  action: "created" | "updated";
  type: "skill";
  name: string;
  sourceUrl: string;
  localVersion: number;
}

interface RemoteSkillSummary {
  name: string;
  description: string;
  tags: string[];
  productionVersion: number;
}

export interface DiffEntry {
  name: string;
  localExists: boolean;
  remoteExists: boolean;
  status: "local_only" | "remote_only" | "both";
}


/* ------------------------------------------------------------------ */
/*  Discover remote                                                    */
/* ------------------------------------------------------------------ */

export async function discoverRemote(
  params: z.infer<typeof SyncDiscoverParams>,
): Promise<RemoteSkillSummary[]> {
  const base = (params.sourceUrl ?? getHubUrl()).replace(/\/+$/, "");
  rejectSelfSync(base);

  const url = params.tag
    ? `${base}/api/skills?tag=${encodeURIComponent(params.tag)}`
    : `${base}/api/skills`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Remote GET ${url} failed (${res.status})`);
  return (await res.json()) as RemoteSkillSummary[];
}

/* ------------------------------------------------------------------ */
/*  Diff local vs remote                                               */
/* ------------------------------------------------------------------ */

export async function diffWithRemote(
  params: z.infer<typeof SyncDiffParams>,
): Promise<DiffEntry[]> {
  const base = (params.sourceUrl ?? getHubUrl()).replace(/\/+$/, "");
  rejectSelfSync(base);

  return diffSkills(base, params.names, params.tag);
}

async function diffSkills(
  base: string,
  names?: string[],
  tag?: string,
): Promise<DiffEntry[]> {
  const [localSkills, remoteSkills] = await Promise.all([
    skillService.listSkills(tag),
    fetchJson<RemoteSkillSummary[]>(
      tag ? `${base}/api/skills?tag=${encodeURIComponent(tag)}` : `${base}/api/skills`,
    ),
  ]);

  const localNames = new Set(localSkills.map((s) => s.name));
  const remoteNames = new Set(remoteSkills.map((s) => s.name));
  const allNames = names?.length
    ? names
    : [...new Set([...localNames, ...remoteNames])].sort();

  return allNames.map((name) => ({
    name,
    localExists: localNames.has(name),
    remoteExists: remoteNames.has(name),
    status: localNames.has(name) && remoteNames.has(name)
      ? "both" as const
      : localNames.has(name) ? "local_only" as const : "remote_only" as const,
  }));
}

/* ------------------------------------------------------------------ */
/*  Pull from remote                                                   */
/* ------------------------------------------------------------------ */

export async function pullFromRemote(
  params: z.infer<typeof SyncPullParams>,
): Promise<SyncPullResult> {
  const base = (params.sourceUrl ?? getHubUrl()).replace(/\/+$/, "");
  rejectSelfSync(base);

  return pullSkill(params.name, base);
}

async function pullSkill(name: string, base: string): Promise<SyncPullResult> {
  const remote = await fetchJson<skillService.SkillDetail>(
    `${base}/api/skills/${encodeURIComponent(name)}`,
  );

  const local = await skillService.getSkill(name);

  if (!local) {
    const { version } = await skillService.createSkill({
      name: remote.name,
      description: remote.description,
      content: remote.content,
      tags: remote.tags,
      metadata: remote.metadata ?? undefined,
    });
    return { action: "created", type: "skill", name, sourceUrl: base, localVersion: version.version };
  }

  // Push new version (latest + 1), always safe to revert
  const { version } = await skillService.updateSkill({
    name: remote.name,
    description: remote.description,
    content: remote.content,
    tags: remote.tags,
    metadata: remote.metadata ?? undefined,
    promote: true,
  });
  return { action: "updated", type: "skill", name, sourceUrl: base, localVersion: version.version };
}

/* ------------------------------------------------------------------ */
/*  Push to remote                                                     */
/* ------------------------------------------------------------------ */

export async function pushToRemote(
  params: z.infer<typeof SyncPushParams>,
): Promise<SyncPushResult> {
  const base = (params.targetUrl ?? getHubUrl()).replace(/\/+$/, "");
  rejectSelfSync(base);

  return pushSkill(params.name, base);
}

async function pushSkill(name: string, base: string): Promise<SyncPushResult> {
  const local = await skillService.getSkill(name);
  if (!local) throw new Error(`Local skill "${name}" not found`);

  const exists = await remoteExists(`${base}/api/skills/${encodeURIComponent(name)}`);

  if (exists) {
    const res = await fetch(`${base}/api/skills/${encodeURIComponent(name)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: local.description,
        content: local.content,
        tags: local.tags,
        metadata: local.metadata,
        promote: true,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Remote PUT /api/skills/${name} failed (${res.status}): ${body}`);
    }
    return { action: "updated", type: "skill", name, targetUrl: base };
  }

  const res = await fetch(`${base}/api/skills`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      description: local.description,
      content: local.content,
      tags: local.tags,
      metadata: local.metadata,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Remote POST /api/skills failed (${res.status}): ${body}`);
  }
  return { action: "created", type: "skill", name, targetUrl: base };
}


/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Remote GET ${url} failed (${res.status}): ${body}`);
  }
  return (await res.json()) as T;
}

async function remoteExists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

