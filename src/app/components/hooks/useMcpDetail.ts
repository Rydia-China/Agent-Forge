"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJson, getErrorMessage, joinTags, parseTags } from "../client-utils";
import type {
  McpSelection,
  SkillDetail,
  SkillVersionSummary,
  McpDetail,
  McpVersionSummary,
  SkillSummary,
  BuiltinMcpSummary,
  McpSummary,
} from "../../types";

export interface UseMcpDetailReturn {
  selectedMcp: McpSelection | null;
  setSelectedMcp: (r: McpSelection | null) => void;
  skillDetail: SkillDetail | null;
  skillVersions: SkillVersionSummary[];
  skillEdit: { description: string; content: string; tags: string };
  setSkillEdit: React.Dispatch<React.SetStateAction<{ description: string; content: string; tags: string }>>;
  mcpDetail: McpDetail | null;
  mcpVersions: McpVersionSummary[];
  mcpEdit: { description: string; code: string };
  setMcpEdit: React.Dispatch<React.SetStateAction<{ description: string; code: string }>>;
  isLoadingMcpDetail: boolean;
  isSavingMcp: boolean;
  isDeletingMcp: boolean;
  isPublishingVersion: boolean;
  error: string | null;
  notice: string | null;
  loadMcpDetail: (resource: McpSelection) => Promise<void>;
  saveSkillVersion: () => Promise<void>;
  saveMcpVersion: () => Promise<void>;
  publishSkillVersion: (ver: number) => Promise<void>;
  publishMcpVersion: (ver: number) => Promise<void>;
  deleteSelectedMcp: () => Promise<void>;
}

export function useMcpDetail(
  loadMcp: () => Promise<void>,
  builtinSkills: SkillSummary[],
  dbSkills: SkillSummary[],
  builtinMcps: BuiltinMcpSummary[],
  mcps: McpSummary[],
): UseMcpDetailReturn {
  const [selectedMcp, setSelectedMcp] = useState<McpSelection | null>(null);
  const [skillDetail, setSkillDetail] = useState<SkillDetail | null>(null);
  const [skillVersions, setSkillVersions] = useState<SkillVersionSummary[]>([]);
  const [skillEdit, setSkillEdit] = useState({ description: "", content: "", tags: "" });
  const [mcpDetail, setMcpDetail] = useState<McpDetail | null>(null);
  const [mcpVersions, setMcpVersions] = useState<McpVersionSummary[]>([]);
  const [mcpEdit, setMcpEdit] = useState({ description: "", code: "" });
  const [isLoadingMcpDetail, setIsLoadingMcpDetail] = useState(false);
  const [isSavingMcp, setIsSavingMcp] = useState(false);
  const [isDeletingMcp, setIsDeletingMcp] = useState(false);
  const [isPublishingVersion, setIsPublishingVersion] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const selectedMcpRef = useRef<string | null>(null);

  useEffect(() => {
    selectedMcpRef.current = selectedMcp
      ? `${selectedMcp.type}:${selectedMcp.name}`
      : null;
  }, [selectedMcp]);

  // Auto-deselect when the resource disappears from lists
  useEffect(() => {
    if (!selectedMcp) return;
    if (selectedMcp.type === "skill") {
      if (
        !builtinSkills.some((s) => s.name === selectedMcp.name) &&
        !dbSkills.some((s) => s.name === selectedMcp.name)
      ) {
        setSelectedMcp(null);
        setSkillDetail(null);
        setSkillVersions([]);
      }
      return;
    }
    if (
      !builtinMcps.some((m) => m.name === selectedMcp.name) &&
      !mcps.some((m) => m.name === selectedMcp.name)
    ) {
      setSelectedMcp(null);
      setMcpDetail(null);
      setMcpVersions([]);
    }
  }, [builtinSkills, builtinMcps, dbSkills, mcps, selectedMcp]);

  const loadMcpDetail = useCallback(async (resource: McpSelection) => {
    const key = `${resource.type}:${resource.name}`;
    selectedMcpRef.current = key;
    setIsLoadingMcpDetail(true);
    setError(null);
    setNotice(null);
    setSelectedMcp(resource);
    try {
      if (resource.type === "skill") {
        const [d, v] = await Promise.all([
          fetchJson<SkillDetail>(`/api/skills/${resource.name}`),
          fetchJson<SkillVersionSummary[]>(`/api/skills/${resource.name}/versions`),
        ]);
        if (selectedMcpRef.current !== key) return;
        setSkillDetail(d);
        setSkillVersions(v);
        setSkillEdit({ description: d.description, content: d.content, tags: joinTags(d.tags) });
        setMcpDetail(null);
        setMcpVersions([]);
      } else {
        const [d, v] = await Promise.all([
          fetchJson<McpDetail>(`/api/mcps/${resource.name}`),
          fetchJson<McpVersionSummary[]>(`/api/mcps/${resource.name}/versions`),
        ]);
        if (selectedMcpRef.current !== key) return;
        setMcpDetail(d);
        setMcpVersions(v);
        setMcpEdit({ description: d.description ?? "", code: d.code });
        setSkillDetail(null);
        setSkillVersions([]);
      }
    } catch (err: unknown) {
      if (selectedMcpRef.current === key)
        setError(getErrorMessage(err, "Failed to load MCP detail."));
    } finally {
      if (selectedMcpRef.current === key) setIsLoadingMcpDetail(false);
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
    setIsSavingMcp(true);
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
      await loadMcp();
      setSkillVersions(
        await fetchJson<SkillVersionSummary[]>(`/api/skills/${skillDetail.name}/versions`),
      );
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to save."));
    } finally {
      setIsSavingMcp(false);
    }
  }, [loadMcp, skillDetail, skillEdit]);

  const saveMcpVersion = useCallback(async () => {
    if (!mcpDetail) return;
    const code = mcpEdit.code.trim();
    if (!code) {
      setError("Code is required.");
      return;
    }
    setIsSavingMcp(true);
    setError(null);
    setNotice(null);
    try {
      const r = await fetchJson<{ version: { version: number } }>(
        `/api/mcps/${mcpDetail.name}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description: mcpEdit.description.trim(),
            code,
            promote: false,
          }),
        },
      );
      setNotice(`已提交版本 v${r.version.version}（未发布）`);
      await loadMcp();
      setMcpVersions(
        await fetchJson<McpVersionSummary[]>(`/api/mcps/${mcpDetail.name}/versions`),
      );
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to save."));
    } finally {
      setIsSavingMcp(false);
    }
  }, [loadMcp, mcpDetail, mcpEdit]);

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
        await loadMcp();
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
    [loadMcp, skillDetail],
  );

  const publishMcpVersion = useCallback(
    async (ver: number) => {
      if (!mcpDetail) return;
      setIsPublishingVersion(true);
      setError(null);
      setNotice(null);
      try {
        const r = await fetchJson<{ loadError?: string }>(
          `/api/mcps/${mcpDetail.name}/production`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ version: ver }),
          },
        );
        if (r.loadError) setError(`Published but load error: ${r.loadError}`);
        else setNotice(`已发布版本 v${ver}`);
        await loadMcp();
        const [d, v] = await Promise.all([
          fetchJson<McpDetail>(`/api/mcps/${mcpDetail.name}`),
          fetchJson<McpVersionSummary[]>(`/api/mcps/${mcpDetail.name}/versions`),
        ]);
        setMcpDetail(d);
        setMcpVersions(v);
      } catch (err: unknown) {
        setError(getErrorMessage(err, "Failed to publish."));
      } finally {
        setIsPublishingVersion(false);
      }
    },
    [loadMcp, mcpDetail],
  );

  const deleteSelectedMcp = useCallback(async () => {
    if (!selectedMcp) return;
    setIsDeletingMcp(true);
    setError(null);
    setNotice(null);
    try {
      await fetchJson<{ deleted: string }>(
        selectedMcp.type === "skill"
          ? `/api/skills/${selectedMcp.name}`
          : `/api/mcps/${selectedMcp.name}`,
        { method: "DELETE" },
      );
      setSelectedMcp(null);
      setSkillDetail(null);
      setSkillVersions([]);
      setMcpDetail(null);
      setMcpVersions([]);
      await loadMcp();
      setNotice("已删除资源");
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to delete."));
    } finally {
      setIsDeletingMcp(false);
    }
  }, [loadMcp, selectedMcp]);

  return {
    selectedMcp,
    setSelectedMcp,
    skillDetail,
    skillVersions,
    skillEdit,
    setSkillEdit,
    mcpDetail,
    mcpVersions,
    mcpEdit,
    setMcpEdit,
    isLoadingMcpDetail,
    isSavingMcp,
    isDeletingMcp,
    isPublishingVersion,
    error,
    notice,
    loadMcpDetail,
    saveSkillVersion,
    saveMcpVersion,
    publishSkillVersion,
    publishMcpVersion,
    deleteSelectedMcp,
  };
}
