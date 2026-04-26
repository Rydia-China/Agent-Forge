"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchJson } from "@/app/components/client-utils";
import type { DomainResources } from "../types";

/** Fetch novel-level shared resources such as characters and scenes. */
export function useNovelResources(novelId: string) {
  const [resources, setResources] = useState<DomainResources>({ categories: [] });
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await fetchJson<DomainResources>(
        `/api/video/novel/${encodeURIComponent(novelId)}/resources`,
      );
      setResources(data);
    } catch (err: unknown) {
      console.error("Failed to fetch novel resources:", err);
      setResources({ categories: [] });
    } finally {
      setIsLoading(false);
    }
  }, [novelId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { resources, isLoading, refresh };
}
