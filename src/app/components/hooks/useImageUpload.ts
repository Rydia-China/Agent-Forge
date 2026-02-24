"use client";

import { useCallback, useRef, useState } from "react";

export interface UseImageUploadReturn {
  pendingImages: string[];
  setPendingImages: React.Dispatch<React.SetStateAction<string[]>>;
  isProcessing: boolean;
  isDragOver: boolean;
  setIsDragOver: (v: boolean) => void;
  isComposing: boolean;
  setIsComposing: (v: boolean) => void;
  handleImageFiles: (files: File[]) => Promise<void>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}

/** Read a File as a base64 data URL. */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read image file."));
    reader.readAsDataURL(file);
  });
}

export function useImageUpload(
  onError: (msg: string) => void,
): UseImageUploadReturn {
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const handleImageFiles = useCallback(
    async (files: File[]) => {
      const imageFiles = files.filter((f) => f.type.startsWith("image/"));
      if (imageFiles.length === 0) return;
      setIsProcessing(true);
      try {
        const results = await Promise.all(
          imageFiles.map(async (f) => {
            try {
              return await fileToDataUrl(f);
            } catch {
              onErrorRef.current("Failed to read image file.");
              return null;
            }
          }),
        );
        const valid = results.filter((u): u is string => u !== null);
        if (valid.length > 0) setPendingImages((prev) => [...prev, ...valid]);
      } finally {
        setIsProcessing(false);
      }
    },
    [],
  );

  return {
    pendingImages,
    setPendingImages,
    isProcessing,
    isDragOver,
    setIsDragOver,
    isComposing,
    setIsComposing,
    handleImageFiles,
    fileInputRef,
  };
}
