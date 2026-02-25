"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchJson } from "@/app/components/client-utils";
import type {
  EpisodeSummary,
  StoryboardScene,
  EpisodeResources,
} from "../types";

export interface UseVideoDataReturn {
  episodes: EpisodeSummary[];
  isLoadingEpisodes: boolean;
  selectedEpisode: EpisodeSummary | null;
  selectEpisode: (ep: EpisodeSummary | null) => void;
  storyboard: StoryboardScene[];
  isLoadingStoryboard: boolean;
  resources: EpisodeResources | null;
  isLoadingResources: boolean;
  refreshEpisodes: () => Promise<EpisodeSummary[]>;
  refreshStoryboard: () => Promise<void>;
  refreshResources: () => Promise<void>;
  refreshAll: () => Promise<void>;
  uploadEpisode: (scriptKey: string, scriptName: string | null, content: string | null) => Promise<void>;
  deleteEpisode: (scriptId: string) => Promise<void>;
  error: string | null;
  setError: (e: string | null) => void;
}

export function useVideoData(novelId: string): UseVideoDataReturn {
  const [episodes, setEpisodes] = useState<EpisodeSummary[]>([]);
  const [isLoadingEpisodes, setIsLoadingEpisodes] = useState(false);
  const [selectedEpisode, setSelectedEpisode] = useState<EpisodeSummary | null>(null);
  const [storyboard, setStoryboard] = useState<StoryboardScene[]>([]);
  const [isLoadingStoryboard, setIsLoadingStoryboard] = useState(false);
  const [resources, setResources] = useState<EpisodeResources | null>(null);
  const [isLoadingResources, setIsLoadingResources] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshEpisodes = useCallback(async (): Promise<EpisodeSummary[]> => {
    setIsLoadingEpisodes(true);
    try {
      const data = await fetchJson<EpisodeSummary[]>(
        `/api/video/novels/${encodeURIComponent(novelId)}/episodes`,
      );
      setEpisodes(data);
      return data;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load episodes");
      return [];
    } finally {
      setIsLoadingEpisodes(false);
    }
  }, [novelId]);

  const refreshStoryboard = useCallback(async () => {
    if (!selectedEpisode) {
      setStoryboard([]);
      return;
    }
    setIsLoadingStoryboard(true);
    try {
      const data = await fetchJson<StoryboardScene[]>(
        `/api/video/episodes/${encodeURIComponent(selectedEpisode.id)}/storyboard`,
      );
      setStoryboard(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load storyboard");
    } finally {
      setIsLoadingStoryboard(false);
    }
  }, [selectedEpisode]);

  const refreshResources = useCallback(async () => {
    if (!selectedEpisode) {
      console.warn("[refreshResources] SKIPPED — selectedEpisode is null");
      setResources(null);
      return;
    }
    console.log(`[refreshResources] fetching for episode=${selectedEpisode.id}`);
    setIsLoadingResources(true);
    try {
      const data = await fetchJson<EpisodeResources>(
        `/api/video/episodes/${encodeURIComponent(selectedEpisode.id)}/resources?novelId=${encodeURIComponent(novelId)}`,
      );
      console.log(`[refreshResources] got: chars=${data.characters.length} costumes=${data.costumes.length} scenes=${data.sceneImages.length} shots=${data.shotImages.length}`);
      setResources(data);
    } catch (err: unknown) {
      console.error("[refreshResources] FAILED:", err);
      setError(err instanceof Error ? err.message : "Failed to load resources");
    } finally {
      setIsLoadingResources(false);
    }
  }, [selectedEpisode, novelId]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshEpisodes(), refreshStoryboard(), refreshResources()]);
  }, [refreshEpisodes, refreshStoryboard, refreshResources]);

  const selectEpisode = useCallback((ep: EpisodeSummary | null) => {
    setSelectedEpisode(ep);
    setStoryboard([]);
    setResources(null);
  }, []);

  const uploadEpisode = useCallback(
    async (scriptKey: string, scriptName: string | null, content: string | null) => {
      try {
        await fetchJson(
          `/api/video/novels/${encodeURIComponent(novelId)}/episodes`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ scriptKey, scriptName, scriptContent: content }),
          },
        );
        await refreshEpisodes();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to create episode");
      }
    },
    [novelId, refreshEpisodes],
  );

  const deleteEpisode = useCallback(
    async (scriptId: string) => {
      try {
        await fetchJson(
          `/api/video/episodes/${encodeURIComponent(scriptId)}`,
          { method: "DELETE" },
        );
        // Deselect if deleted EP was selected
        if (selectedEpisode?.id === scriptId) {
          setSelectedEpisode(null);
          setStoryboard([]);
          setResources(null);
        }
        await refreshEpisodes();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to delete episode");
      }
    },
    [selectedEpisode, refreshEpisodes],
  );

  // Load episodes on mount
  useEffect(() => {
    void refreshEpisodes();
  }, [refreshEpisodes]);

  // Load storyboard + resources when episode changes
  useEffect(() => {
    if (selectedEpisode) {
      void refreshStoryboard();
      void refreshResources();
    }
  }, [selectedEpisode, refreshStoryboard, refreshResources]);

  return {
    episodes,
    isLoadingEpisodes,
    selectedEpisode,
    selectEpisode,
    storyboard,
    isLoadingStoryboard,
    resources,
    isLoadingResources,
    refreshEpisodes,
    refreshStoryboard,
    refreshResources,
    refreshAll,
    uploadEpisode,
    deleteEpisode,
    error,
    setError,
  };
}
