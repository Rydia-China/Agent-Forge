"use client";

import { useCallback, useEffect, useState } from "react";

const USER_STORAGE_KEY = "agentForge.user";

export interface UseUserReturn {
  userName: string;
  userDraft: string;
  setUserDraft: (v: string) => void;
  applyUserName: () => void;
}

export function useUser(onUserChanged: () => void): UseUserReturn {
  const [userName, setUserName] = useState(() => {
    if (typeof window === "undefined") return "default";
    const s = window.localStorage.getItem(USER_STORAGE_KEY);
    return s && s.trim().length > 0 ? s : "default";
  });
  const [userDraft, setUserDraft] = useState(() => {
    if (typeof window === "undefined") return "default";
    const s = window.localStorage.getItem(USER_STORAGE_KEY);
    return s && s.trim().length > 0 ? s : "default";
  });

  // Persist draft to localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    const n = userDraft.trim();
    if (n.length > 0) window.localStorage.setItem(USER_STORAGE_KEY, n);
    else window.localStorage.removeItem(USER_STORAGE_KEY);
  }, [userDraft]);

  const applyUserName = useCallback(() => {
    setUserName(userDraft.trim() || "default");
    onUserChanged();
  }, [userDraft, onUserChanged]);

  return { userName, userDraft, setUserDraft, applyUserName };
}
