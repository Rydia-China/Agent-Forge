"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchJson } from "@/app/components/client-utils";

/* ------------------------------------------------------------------ */
/*  Types (matches langfuse-prompt-service output)                     */
/* ------------------------------------------------------------------ */

export interface PromptListItem {
  name: string;
  versions?: number[];
  labels?: string[];
  tags?: string[];
}

export interface PromptDetail {
  name: string;
  version: number;
  template: string;
  labels: string[];
  tags: string[];
  type: "text" | "chat";
  rawPrompt: string | unknown[];
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export interface UsePromptsReturn {
  /** All prompts (metadata only). */
  prompts: PromptListItem[];
  isLoadingList: boolean;
  refreshList: () => Promise<void>;

  /** Currently selected prompt detail (specific version). */
  selectedPrompt: PromptDetail | null;
  isLoadingDetail: boolean;

  /** All versions for the selected prompt. */
  versions: PromptDetail[];
  isLoadingVersions: boolean;

  /** Select a prompt by name (loads production version + versions list). */
  selectPrompt: (name: string) => void;
  /** Switch to a specific version of the selected prompt. */
  selectVersion: (version: number) => void;

  /** Save a new version. Returns the created detail. */
  saveNewVersion: (
    content: string,
    opts?: { labels?: string[] },
  ) => Promise<PromptDetail>;
  isSaving: boolean;

  error: string | null;
}

export function usePrompts(): UsePromptsReturn {
  const [prompts, setPrompts] = useState<PromptListItem[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(false);

  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [selectedPrompt, setSelectedPrompt] = useState<PromptDetail | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  const [versions, setVersions] = useState<PromptDetail[]>([]);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);

  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ---- List ---- */
  const refreshList = useCallback(async () => {
    setIsLoadingList(true);
    setError(null);
    try {
      const data = await fetchJson<PromptListItem[]>("/api/prompts");
      setPrompts(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load prompts");
    } finally {
      setIsLoadingList(false);
    }
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  /* ---- Detail ---- */
  const loadDetail = useCallback(async (name: string, version?: number) => {
    setIsLoadingDetail(true);
    try {
      const qs = version != null ? `?version=${version}` : "";
      const data = await fetchJson<PromptDetail>(
        `/api/prompts/${encodeURIComponent(name)}${qs}`,
      );
      setSelectedPrompt(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load prompt");
    } finally {
      setIsLoadingDetail(false);
    }
  }, []);

  /* ---- Versions ---- */
  const loadVersions = useCallback(async (name: string) => {
    setIsLoadingVersions(true);
    try {
      const data = await fetchJson<PromptDetail[]>(
        `/api/prompts/${encodeURIComponent(name)}/versions`,
      );
      setVersions(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load versions");
    } finally {
      setIsLoadingVersions(false);
    }
  }, []);

  /* ---- Select prompt ---- */
  const selectPrompt = useCallback(
    (name: string) => {
      setSelectedName(name);
      setSelectedPrompt(null);
      setVersions([]);
      void loadDetail(name);
      void loadVersions(name);
    },
    [loadDetail, loadVersions],
  );

  /* ---- Select version ---- */
  const selectVersion = useCallback(
    (version: number) => {
      if (!selectedName) return;
      void loadDetail(selectedName, version);
    },
    [selectedName, loadDetail],
  );

  /* ---- Save new version ---- */
  const saveNewVersion = useCallback(
    async (
      content: string,
      opts?: { labels?: string[] },
    ): Promise<PromptDetail> => {
      if (!selectedName) throw new Error("No prompt selected");
      setIsSaving(true);
      try {
        const detail = await fetchJson<PromptDetail>(
          `/api/prompts/${encodeURIComponent(selectedName)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt: content,
              type: selectedPrompt?.type ?? "text",
              labels: opts?.labels,
            }),
          },
        );
        // Refresh versions & select the new one
        setSelectedPrompt(detail);
        void loadVersions(selectedName);
        void refreshList();
        return detail;
      } finally {
        setIsSaving(false);
      }
    },
    [selectedName, selectedPrompt?.type, loadVersions, refreshList],
  );

  return {
    prompts,
    isLoadingList,
    refreshList,
    selectedPrompt,
    isLoadingDetail,
    versions,
    isLoadingVersions,
    selectPrompt,
    selectVersion,
    saveNewVersion,
    isSaving,
    error,
  };
}
