/**
 * Zod validation schema for novel script JSON upload.
 *
 * Format: a single novel object with synopsis, character_arcs, location_bible
 * at the novel level, and an episodes[] array inside.
 * Uses `.passthrough()` throughout to allow extra fields.
 */

import { z } from "zod";

/* ------------------------------------------------------------------ */
/*  Novel-level: character arc                                         */
/* ------------------------------------------------------------------ */

const CharacterArcSchema = z
  .object({
    name: z.string(),
    appearance: z.string().optional(),
    personality: z.string().optional(),
    gender: z.string().optional(),
    age: z.string().optional(),
    socialStatus: z.string().optional(),
  })
  .passthrough();

/* ------------------------------------------------------------------ */
/*  Novel-level: location bible sub-location                           */
/* ------------------------------------------------------------------ */

const SubLocationSchema = z
  .object({
    id: z.union([z.string(), z.null()]),
    name: z.string(),
    description: z.string().optional(),
    visual_prompt: z.string().optional(),
  })
  .passthrough();

/* ------------------------------------------------------------------ */
/*  Novel-level: location bible entry                                  */
/* ------------------------------------------------------------------ */

const LocationBibleSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    visual_prompt: z.string().optional(),
    sub_locations: z.array(SubLocationSchema).optional(),
  })
  .passthrough();

/* ------------------------------------------------------------------ */
/*  Episode-level: scene location (kept for per-ep overrides)          */
/* ------------------------------------------------------------------ */

const SceneLocationSchema = z
  .object({
    location_id: z.union([z.string(), z.null()]),
    parent_location_id: z.union([z.string(), z.null()]),
    visual_prompt: z.string(),
  })
  .passthrough();

/* ------------------------------------------------------------------ */
/*  Choice option                                                      */
/* ------------------------------------------------------------------ */

const ChoiceOptionSchema = z
  .object({
    id: z.string(),
    content: z.string(),
    description: z.string(),
    check: z.string(),
  })
  .passthrough();

/* ------------------------------------------------------------------ */
/*  Choice node                                                        */
/* ------------------------------------------------------------------ */

const ChoiceNodeSchema = z
  .object({
    type: z.string(),
    options: z.array(ChoiceOptionSchema).min(1),
  })
  .passthrough();

/* ------------------------------------------------------------------ */
/*  Post-choice outcome                                                */
/* ------------------------------------------------------------------ */

const PostChoiceOutcomeSchema = z
  .object({
    reaction_id: z.string(),
    trigger_condition: z.string(),
    story_content: z.string(),
    butterfly_effect: z.string(),
  })
  .passthrough();

/* ------------------------------------------------------------------ */
/*  Episode output                                                     */
/* ------------------------------------------------------------------ */

const EpisodeOutputSchema = z
  .object({
    episode_id: z.string(),
    episode_title: z.string(),
    characters: z.array(z.string()),
    character_outfits: z.record(z.string(), z.string()).optional(),
    scene_locations: z.record(z.string(), SceneLocationSchema).optional(),
    pre_choice_script: z.string(),
    choice_node: ChoiceNodeSchema,
    post_choice_outcomes: z.array(PostChoiceOutcomeSchema).min(1),
  })
  .passthrough();

/* ------------------------------------------------------------------ */
/*  Single episode entry                                               */
/* ------------------------------------------------------------------ */

export const ScriptEpisodeSchema = z
  .object({
    ep_num: z.number().int().positive(),
    variant_kind: z.string(),
    output: EpisodeOutputSchema,
  })
  .passthrough();

/* ------------------------------------------------------------------ */
/*  Root: novel object (novel-level + episodes[])                      */
/* ------------------------------------------------------------------ */

export const NovelScriptUploadSchema = z
  .object({
    title: z.string().optional(),
    synopsis: z.unknown().optional(),
    character_arcs: z.array(CharacterArcSchema).optional(),
    location_bible: z.array(LocationBibleSchema).optional(),
    episodes: z.array(ScriptEpisodeSchema).min(1, "At least one episode is required"),
  })
  .passthrough();

/* ------------------------------------------------------------------ */
/*  Inferred types                                                     */
/* ------------------------------------------------------------------ */

export type ScriptEpisode = z.infer<typeof ScriptEpisodeSchema>;
export type NovelScriptUpload = z.infer<typeof NovelScriptUploadSchema>;
