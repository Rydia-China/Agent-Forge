import { useState, useEffect } from "react";

export interface CostumePreview {
  characterName: string;
  outfitDesc: string;
  compiledPrompt: string;
  portraitKey: string;
  portraitUrl: string | null;
}

export function useCostumePreview(novelId: string, scriptId: string | null, styleName: string) {
  const [costumes, setCostumes] = useState<CostumePreview[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!scriptId) {
      setCostumes([]);
      return;
    }

    const fetchCostumes = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ styleName });
        const res = await fetch(
          `/api/video/novels/${novelId}/scripts/${scriptId}/costume-preview?${params}`
        );
        if (!res.ok) {
          throw new Error(`Failed to fetch costumes: ${res.statusText}`);
        }
        const data = await res.json();
        setCostumes(data.costumes ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        setCostumes([]);
      } finally {
        setLoading(false);
      }
    };

    fetchCostumes();
  }, [novelId, scriptId, styleName]);

  return { costumes, loading, error };
}
