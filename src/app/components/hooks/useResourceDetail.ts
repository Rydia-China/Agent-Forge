"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJson, getErrorMessage, joinTags, parseTags } from "../client-utils";
import type {
  ResourceSelection,
  SkillDetail,
  SkillVersionSummary,
  SkillSummary,
  BuiltinMcpSummary,
} from "../../types";

export interface UseResourceDetailReturn {
  selectedResource: ResourceSelection | null;
  setSelectedResource: (r: ResourceSelection | null) => void;
  skillDetail: SkillDetail | null;
  skillVersions: SkillVersionSummary[];
  skillEdit: { description: string; content: string; tags: string };
  setSkillEdit: React.Dispatch<React.SetStateAction<{ description: string; content: string; tags: string }>>;
  isLoadingResourceDetail: boolean;
  isSavingResource: boolean;
  isDeletingResource: boolean;
  isPublishingVersion: boolean;
  error: string | null;
  notice: string | null;
  loadResourceDetail: (resource: ResourceSelection) => Promise<void>;
  saveSkillVersion: () => Promise<void>;
  publishSkillVersion: (ver: number) => Promise<void>;
  deleteSelectedResource: () => Promise<void>;
}

export function useResourceDetail(
  loadResources: () => Promise<void>,
  skills: SkillSummary[],
): UseResourceDetailReturn {
  const [selectedResource, setSelectedResource] = useState<ResourceSelection | null>(null);
  const [skillDetail, setSkillDetail] = useState<SkillDetail | null>(null);
  const [skillVersions, setSkillVersions] = useState<SkillVersionSummary[]>([]);
  const [skillEdit, setSkillEdit] = useState({ description: "", content: "", tags: "" });
  const [isLoadingResourceDetail, setIsLoadingResourceDetail] = useState(false);
  const [isSavingResource, setIsSavingResource] = useState(false);
  const [isDeletingResource, setIsDeletingResource] = useState(false);
  const [isPublishingVersion, setIsPublishingVersion] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const selectedResourceRef = useRef<string | null>(null);

  useEffect(() => {
    selectedResourceRef.current = selectedResource
      ? `${selectedResource.type}:${selectedResource.name}`
      : null;
  }, [selectedResource]);

  // Auto-deselect when the resource disappears from lists
  useEffect(() => {
    if (!selectedResource) return;
    if (selectedResource.type === "skill") {
      if (!skills.some((s) => s.name === selectedResource.name)) {
        setSelectedResource(null);
        setSkillDetail(null);
        setSkillVersions([]);
      }
    }
  }, [skills, selectedResource]);

  const loadResourceDetail = useCallback(async (resource: ResourceSelection) => {
    const key = `${resource.type}:${resource.name}`;
    selectedResourceRef.current = key;
    setIsLoadingResourceDetail(true);
    setError(null);
    setNotice(null);
    setSelectedResource(resource);
    try {
      if (resource.type === "skill") {
        const [d, v] = await Promise.all([
          fetchJson<SkillDetail>(`/api/skills/${resource.name}`),
          fetchJson<SkillVersionSummary[]>(`/api/skills/${resource.name}/versions`),
        ]);
        if (selectedResourceRef.current !== key) return;
        setSkillDetail(d);
        setSkillVersions(v);
        setSkillEdit({ description: d.description, content: d.content, tags: joinTags(d.tags) });
      } else {
        setNotice("内置 MCPS 不支持查看详情");
      }
    } catch (err: unknown) {
      if (selectedResourceRef.current === key)
        setError(getErrorMessage(err, "Failed to load resource."));
    } finally {
      if (selectedResourceRef.current === key) setIsLoadingResourceDetail(false);
    }
  }, []);

  const saveSkillVersion = useCallback(async () => {
    if (!skillDetail) return;
    const desc = skillEdit.description.trim();
    const cont = skillEdit.content.trim();
    if (!desc || !cont) {
      setError("Description and content are required.");
      return;
    }
    setIsSavingResource(true);
    setError(null);
    setNotice(null);
    try {
      const r = await fetchJson<{ version: { version: number } }>(
        `/api/skills/${skillDetail.name}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description: desc,
            content: cont,
            tags: parseTags(skillEdit.tags),
            promote: false,
          }),
        },
      );
      setNotice(`已提交版本 v${r.version.version}（未发布）`);
      await loadResources();
      setSkillVersions(
        await fetchJson<SkillVersionSummary[]>(`/api/skills/${skillDetail.name}/versions`),
      );
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to save."));
    } finally {
      setIsSavingResource(false);
    }
  }, [loadResources, skillDetail, skillEdit]);

  const publishSkillVersion = useCallback(
    async (ver: number) => {
      if (!skillDetail) return;
      setIsPublishingVersion(true);
      setError(null);
      setNotice(null);
      try {
        await fetchJson(`/api/skills/${skillDetail.name}/production`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ version: ver }),
        });
        await loadResources();
        const [d, v] = await Promise.all([
          fetchJson<SkillDetail>(`/api/skills/${skillDetail.name}`),
          fetchJson<SkillVersionSummary[]>(`/api/skills/${skillDetail.name}/versions`),
        ]);
        setSkillDetail(d);
        setSkillVersions(v);
        setNotice(`已发布版本 v${ver}`);
      } catch (err: unknown) {
        setError(getErrorMessage(err, "Failed to publish."));
      } finally {
        setIsPublishingVersion(false);
      }
    },
    [loadResources, skillDetail],
  );

  const deleteSelectedResource = useCallback(async () => {
    if (!selectedResource) return;
    setIsDeletingResource(true);
    setError(null);
    setNotice(null);
    try {
      await fetchJson<{ deleted: string }>(
        `/api/skills/${selectedResource.name}`,
        { method: "DELETE" },
      );
      setSelectedResource(null);
      setSkillDetail(null);
      setSkillVersions([]);
      await loadResources();
      setNotice("已删除资源");
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to delete."));
    } finally {
      setIsDeletingResource(false);
    }
  }, [loadResources, selectedResource]);

  return {
    selectedResource,
    setSelectedResource,
    skillDetail,
    skillVersions,
    skillEdit,
    setSkillEdit,
    isLoadingResourceDetail,
    isSavingResource,
    isDeletingResource,
    isPublishingVersion,
    error,
    notice,
    loadResourceDetail,
    saveSkillVersion,
    publishSkillVersion,
    deleteSelectedResource,
  };
}
