/**
 * Resource Key Utilities - Key computation and JSON parsing helpers
 * 
 * This module provides:
 * - Resource key computation functions (portraits, scenes, costumes)
 * - JSON parsing and type guard utilities
 */

import type { ScriptEpisode } from "@/lib/video/script-upload-schema";

/* ------------------------------------------------------------------ */
/*  Key computation helpers                                            */
/* ------------------------------------------------------------------ */

export function scriptKeyForEpisode(episode: ScriptEpisode): string {
  return episode.variant_kind === "mainline"
    ? `EP${episode.ep_num}`
    : `EP${episode.ep_num}-${episode.variant_kind}`;
}

/** Key computation — must match video workflow tools exactly. */
export function portraitKey(name: string): string {
  return `char_${name.toLowerCase().replace(/\s+/g, "_")}_portrait`;
}

export function sceneKey(sceneName: string): string {
  return `scene_${sceneName.replace(/\s+/g, "_")}`;
}

export function sceneGridKey(sceneName: string): string {
  return `scene_${sceneName.replace(/\s+/g, "_")}_grid`;
}

export function costumeKey(name: string): string {
  return `costume_${name.toLowerCase().replace(/\s+/g, "_")}`;
}

/* ------------------------------------------------------------------ */
/*  JSON parsing helpers                                               */
/* ------------------------------------------------------------------ */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseJsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  if (!value.trim()) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export function parseRecord(value: unknown): Record<string, unknown> | null {
  const parsed = parseJsonValue(value);
  return isRecord(parsed) ? parsed : null;
}

export function parseArray(value: unknown): unknown[] {
  const parsed = parseJsonValue(value);
  return Array.isArray(parsed) ? parsed : [];
}
