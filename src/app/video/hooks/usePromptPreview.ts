import { useState, useEffect, useCallback } from "react";
import { fetchJson } from "@/app/components/client-utils";

/* ------------------------------------------------------------------ */
/*  Types (mirror service types)                                       */
/* ------------------------------------------------------------------ */

export interface CharacterPreview {
  name: string;
  gender: string | null;
  age: string | null;
  appearance: string | null;
  personality: string | null;
  socialStatus: string | null;
  compiledPrompt: string | null;
  portraitUrl: string | null;
}

export interface ScenePreview {
  name: string;
  visualPrompt: string | null;
  description: string | null;
  compiledPrompt: string | null;
  mode: "single" | "grid" | "hd";
  imageUrl: string | null;
  parentName: string | null;
}

export interface PromptPreviewData {
  characters: CharacterPreview[];
  scenes: ScenePreview[];
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function usePromptPreview(novelId: string) {
  const [data, setData] = useState<PromptPreviewData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  /* ---- Load preview (styles are fixed per mode, no selectors needed) ---- */
  const loadPreview = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await fetchJson<PromptPreviewData>(
        `/api/video/novel/${encodeURIComponent(novelId)}/prompt-preview`,
      );
      setData(result);
    } catch {
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [novelId]);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  /* ---- Update a field ---- */
  const updateField = useCallback(
    async (
      target: "character" | "location" | "sub_location",
      name: string,
      field: string,
      value: string,
      parentName?: string,
    ) => {
      setIsSaving(true);
      try {
        await fetchJson(
          `/api/video/novel/${encodeURIComponent(novelId)}/prompt-fields`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ target, name, field, value, parentName }),
          },
        );
        // Refresh preview after update
        await loadPreview();
      } finally {
        setIsSaving(false);
      }
    },
    [novelId, loadPreview],
  );

  return {
    data,
    isLoading,
    isSaving,
    updateField,
    refresh: loadPreview,
  };
}
