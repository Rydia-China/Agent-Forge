/**
 * Zod validation schema for novel script JSON upload.
 *
 * Format: JSON array of episodes. Fields can be MORE but not FEWER
 * than the required set below. Uses `.passthrough()` throughout.
 */

import { z } from "zod";

/* ------------------------------------------------------------------ */
/*  Scene location                                                     */
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
    character_outfits: z.record(z.string(), z.string()),
    scene_locations: z.record(z.string(), SceneLocationSchema),
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
/*  Root: array of episodes                                            */
/* ------------------------------------------------------------------ */

export const NovelScriptUploadSchema = z
  .array(ScriptEpisodeSchema)
  .min(1, "At least one episode is required");

/* ------------------------------------------------------------------ */
/*  Inferred types                                                     */
/* ------------------------------------------------------------------ */

export type ScriptEpisode = z.infer<typeof ScriptEpisodeSchema>;
export type NovelScriptUpload = z.infer<typeof NovelScriptUploadSchema>;
