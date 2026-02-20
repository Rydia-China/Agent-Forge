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
  const [userName, setUserName] = useState("default");
  const [userDraft, setUserDraft] = useState("default");

  // Restore from localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    const s = window.localStorage.getItem(USER_STORAGE_KEY);
    if (s && s.trim().length > 0) {
      setUserName(s);
      setUserDraft(s);
    }
  }, []);

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
