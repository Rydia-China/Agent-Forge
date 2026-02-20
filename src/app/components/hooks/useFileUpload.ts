"use client";

import { useCallback, useState } from "react";
import type { AgentStatus } from "../StatusBadge";
import { fetchJson, getErrorMessage, isRecord } from "../client-utils";
import type { UploadRequestPayload } from "../../types";

export interface UseFileUploadReturn {
  uploadProgress: string | null;
  executeUpload: (req: UploadRequestPayload, file: File) => Promise<void>;
  openManualUpload: () => void;
  cancelUpload: (req: UploadRequestPayload) => Promise<void>;
}

export function useFileUpload(
  sessionIdRef: React.RefObject<string | undefined>,
  setUploadDialog: (req: UploadRequestPayload | null) => void,
  setStatus: (s: AgentStatus) => void,
  setError: (msg: string | null) => void,
  reloadSession: () => Promise<void>,
): UseFileUploadReturn {
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);

  const executeUpload = useCallback(
    async (req: UploadRequestPayload, file: File) => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      setUploadProgress("上传中…");
      setStatus("running");
      const timeoutMs = (req.timeout ?? 60) * 1000;
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      try {
        let res: Response;
        if (req.bodyTemplate) {
          const fileText = await file.text();
          const nameNoExt = file.name.replace(/\.[^.]+$/, "");
          const now = new Date();
          const ts = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
          const rp = (s: string) =>
            s
              .replace(/\{\{fileContent\}\}/g, fileText)
              .replace(/\{\{fileName\}\}/g, nameNoExt)
              .replace(/\{\{fileNameFull\}\}/g, file.name)
              .replace(/\{\{timestamp\}\}/g, ts);
          const jsonBody: Record<string, string> = {};
          for (const [k, v] of Object.entries(req.bodyTemplate)) jsonBody[k] = rp(v);
          setUploadProgress(`上传中… (${(file.size / 1024 / 1024).toFixed(1)}MB)`);
          res = await fetch(req.endpoint, {
            method: req.method,
            headers: { "Content-Type": "application/json", ...req.headers },
            body: JSON.stringify(jsonBody),
            signal: ac.signal,
          });
        } else if (req.method === "PUT") {
          res = await fetch(req.endpoint, {
            method: "PUT",
            headers: { ...req.headers },
            body: file,
            signal: ac.signal,
          });
        } else {
          const form = new FormData();
          if (req.fields) for (const [k, v] of Object.entries(req.fields)) form.append(k, v);
          form.append(req.fileFieldName, file);
          res = await fetch(req.endpoint, {
            method: "POST",
            headers: { ...req.headers },
            body: form,
            signal: ac.signal,
          });
        }

        let url: string | undefined;
        try {
          const body: unknown = await res.json();
          if (isRecord(body) && typeof body.url === "string") url = body.url;
        } catch {
          /* non-JSON */
        }

        await fetchJson(`/api/sessions/${sid}/upload-result`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            uploadId: req.uploadId,
            success: res.ok,
            url,
            filename: file.name,
            size: file.size,
            error: res.ok ? undefined : `HTTP ${res.status}`,
          }),
        });
        setUploadProgress(null);
        setUploadDialog(null);
        await reloadSession();
      } catch (err: unknown) {
        setUploadProgress(null);
        if (err instanceof DOMException && err.name === "AbortError") {
          setError(`上传超时 (${req.timeout ?? 60}s)`);
        } else {
          setError(getErrorMessage(err, "Upload failed."));
        }
      } finally {
        clearTimeout(timer);
      }
    },
    [sessionIdRef, setUploadDialog, setStatus, setError, reloadSession],
  );

  const openManualUpload = useCallback(() => {
    setUploadDialog({
      uploadId: crypto.randomUUID(),
      endpoint: "",
      method: "POST",
      fileFieldName: "file",
      purpose: "手动上传文件",
    });
  }, [setUploadDialog]);

  const cancelUpload = useCallback(
    async (req: UploadRequestPayload) => {
      const sid = sessionIdRef.current;
      setUploadDialog(null);
      setUploadProgress(null);
      setStatus("running");
      if (!sid) return;
      try {
        await fetchJson(`/api/sessions/${sid}/upload-result`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uploadId: req.uploadId, success: false }),
        });
        await reloadSession();
      } catch {
        /* best effort */
      }
    },
    [sessionIdRef, setUploadDialog, setStatus, reloadSession],
  );

  return { uploadProgress, executeUpload, openManualUpload, cancelUpload };
}
