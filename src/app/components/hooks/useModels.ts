"use client";

import { useEffect, useState } from "react";
import { fetchJson } from "../client-utils";

export interface ModelInfo {
  id: string;
  label: string;
  maxContextTokens: number;
}

interface ModelsResponse {
  models: ModelInfo[];
  default: string;
}

/**
 * Fetch available controller models once on mount.
 * Returns the list + the current selected model id.
 */
export function useModels() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");

  useEffect(() => {
    void fetchJson<ModelsResponse>("/api/models").then((data) => {
      setModels(data.models);
      setSelectedModel((prev) => prev || data.default);
    });
  }, []);

  return { models, selectedModel, setSelectedModel };
}
