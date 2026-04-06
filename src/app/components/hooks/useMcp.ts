"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchJson, getErrorMessage } from "../client-utils";
import type { SkillSummary, McpSummary, BuiltinMcpSummary } from "../../types";

export interface UseResourcesReturn {
  skills: SkillSummary[];
  mcps: McpSummary[];
  builtinMcps: BuiltinMcpSummary[];
  builtinSkills: SkillSummary[];
  dbSkills: SkillSummary[];
  isLoadingResources: boolean;
  loadResources: () => Promise<void>;
}

export function useResources(
  currentSessionIdRef: React.RefObject<string | undefined>,
  onError: (msg: string) => void,
): UseResourcesReturn {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [mcps, setMcps] = useState<McpSummary[]>([]);
  const [builtinMcps, setBuiltinMcps] = useState<BuiltinMcpSummary[]>([]);
  const [isLoadingResources, setIsLoadingResources] = useState(false);

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const builtinSkills = useMemo(
    () => skills.filter((s) => s.productionVersion === 0),
    [skills],
  );
  const dbSkills = useMemo(
    () => skills.filter((s) => s.productionVersion > 0),
    [skills],
  );

  const loadResources = useCallback(async () => {
    setIsLoadingResources(true);
    try {
      const sid = currentSessionIdRef.current;
      const sp = sid ? `?session=${encodeURIComponent(sid)}` : "";
      const [sk, mc, bm] = await Promise.all([
        fetchJson<SkillSummary[]>("/api/skills"),
        fetchJson<McpSummary[]>("/api/mcps"),
        fetchJson<BuiltinMcpSummary[]>(`/api/mcps/builtins${sp}`),
      ]);
      setSkills(sk);
      setMcps(mc);
      setBuiltinMcps(bm);
    } catch (err: unknown) {
      onErrorRef.current(getErrorMessage(err, "Failed to load resources."));
    } finally {
      setIsLoadingResources(false);
    }
  }, [currentSessionIdRef]);

  useEffect(() => {
    void loadResources();
  }, [loadResources]);

  return {
    skills,
    mcps,
    builtinMcps,
    builtinSkills,
    dbSkills,
    isLoadingResources,
    loadResources,
  };
}
