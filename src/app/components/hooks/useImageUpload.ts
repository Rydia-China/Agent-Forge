"use client";

import { useCallback, useRef, useState } from "react";
import { fetchJson, getErrorMessage } from "../client-utils";

export interface UseImageUploadReturn {
  pendingImages: string[];
  setPendingImages: React.Dispatch<React.SetStateAction<string[]>>;
  isUploading: boolean;
  isDragOver: boolean;
  setIsDragOver: (v: boolean) => void;
  isComposing: boolean;
  setIsComposing: (v: boolean) => void;
  handleImageFiles: (files: File[]) => Promise<void>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}

export function useImageUpload(
  onError: (msg: string) => void,
): UseImageUploadReturn {
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const uploadImage = useCallback(
    async (file: File): Promise<string | null> => {
      const form = new FormData();
      form.append("file", file);
      form.append("folder", "chat-images");
      try {
        const result = await fetchJson<{ url: string }>("/api/oss/upload", {
          method: "POST",
          body: form,
        });
        return result.url;
      } catch (err: unknown) {
        onErrorRef.current(getErrorMessage(err, "Failed to upload image."));
        return null;
      }
    },
    [],
  );

  const handleImageFiles = useCallback(
    async (files: File[]) => {
      const imageFiles = files.filter((f) => f.type.startsWith("image/"));
      if (imageFiles.length === 0) return;
      setIsUploading(true);
      try {
        const urls = await Promise.all(imageFiles.map(uploadImage));
        const valid = urls.filter((u): u is string => u !== null);
        if (valid.length > 0) setPendingImages((prev) => [...prev, ...valid]);
      } finally {
        setIsUploading(false);
      }
    },
    [uploadImage],
  );

  return {
    pendingImages,
    setPendingImages,
    isUploading,
    isDragOver,
    setIsDragOver,
    isComposing,
    setIsComposing,
    handleImageFiles,
    fileInputRef,
  };
}
