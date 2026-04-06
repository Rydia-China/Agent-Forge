"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchJson } from "@/app/components/client-utils";
import type {
  EpisodeSummary,
  ResourceData,
} from "../types";

export interface UseVideoDataReturn {
  episodes: EpisodeSummary[];
  isLoadingEpisodes: boolean;
  selectedEpisode: EpisodeSummary | null;
  selectEpisode: (ep: EpisodeSummary | null) => void;
  resources: ResourceData | null;
  isLoadingResources: boolean;
  refreshEpisodes: () => Promise<EpisodeSummary[]>;
  refreshResources: () => Promise<void>;
  refreshAll: () => Promise<void>;
  deleteEpisode: (scriptId: string) => Promise<void>;
  error: string | null;
  setError: (e: string | null) => void;
}

export function useVideoData(novelId: string): UseVideoDataReturn {
  const [episodes, setEpisodes] = useState<EpisodeSummary[]>([]);
  const [isLoadingEpisodes, setIsLoadingEpisodes] = useState(false);
  const [selectedEpisode, setSelectedEpisode] = useState<EpisodeSummary | null>(null);
  const [resources, setResources] = useState<ResourceData | null>(null);
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

  const refreshResources = useCallback(async () => {
    if (!selectedEpisode) {
      console.warn("[refreshResources] SKIPPED — selectedEpisode is null");
      setResources(null);
      return;
    }
    console.log(`[refreshResources] fetching for episode=${selectedEpisode.id}`);
    setIsLoadingResources(true);
    try {
      const data = await fetchJson<ResourceData>(
        `/api/video/episodes/${encodeURIComponent(selectedEpisode.id)}/resources?novelId=${encodeURIComponent(novelId)}`,
      );
      console.log(`[refreshResources] got: categories=${data.categories.length}`);
      setResources(data);
    } catch (err: unknown) {
      console.error("[refreshResources] FAILED:", err);
      setError(err instanceof Error ? err.message : "Failed to load resources");
    } finally {
      setIsLoadingResources(false);
    }
  }, [selectedEpisode, novelId]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshEpisodes(), refreshResources()]);
  }, [refreshEpisodes, refreshResources]);

  const selectEpisode = useCallback((ep: EpisodeSummary | null) => {
    setSelectedEpisode(ep);
    setResources(null);
  }, []);

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

  // Load resources when episode changes
  useEffect(() => {
    if (selectedEpisode) {
      void refreshResources();
    }
  }, [selectedEpisode, refreshResources]);

  return {
    episodes,
    isLoadingEpisodes,
    selectedEpisode,
    selectEpisode,
    resources,
    isLoadingResources,
    refreshEpisodes,
    refreshResources,
    refreshAll,
    deleteEpisode,
    error,
    setError,
  };
}
