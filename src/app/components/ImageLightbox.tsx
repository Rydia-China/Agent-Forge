"use client";

import { Image } from "antd";

export interface ImageLightboxProps {
  url: string;
  onClose: () => void;
}

export function ImageLightbox({ url, onClose }: ImageLightboxProps) {
  return (
    <Image
      src={url}
      alt="Preview"
      style={{ display: "none" }}
      preview={{
        visible: true,
        onVisibleChange: (visible) => {
          if (!visible) onClose();
        },
      }}
    />
  );
}
