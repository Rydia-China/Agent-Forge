import { useState, useEffect, useCallback } from "react";
import type { ResourceData } from "../types";

/**
 * useNovelResources — fetch novel-level resources (characters, scenes).
 */
export function useNovelResources(novelId: string) {
  const [resources, setResources] = useState<ResourceData>({ categories: [] });
  const [isLoading, setIsLoading] = useState(false);

  const fetchResources = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/video/novel/${novelId}/resources`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ResourceData;
      setResources(data);
    } catch (err) {
      console.error("Failed to fetch novel resources:", err);
      setResources({ categories: [] });
    } finally {
      setIsLoading(false);
    }
  }, [novelId]);

  useEffect(() => {
    void fetchResources();
  }, [fetchResources]);

  return { resources, isLoading, refresh: fetchResources };
}
