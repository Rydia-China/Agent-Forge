"use client";

import { ConfigProvider, theme, App } from "antd";
import { AntdRegistry } from "@ant-design/nextjs-registry";

export default function AntdProvider({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <AntdRegistry>
      <ConfigProvider
        theme={{
          algorithm: theme.darkAlgorithm,
          token: {
            colorPrimary: "#1668dc",
            fontSize: 16,
            fontSizeSM: 14,
            fontSizeLG: 18,
            fontSizeXL: 24,
            fontSizeHeading1: 24,
            fontSizeHeading2: 24,
            fontSizeHeading3: 24,
            fontSizeHeading4: 24,
            fontSizeHeading5: 18,
          },
        }}
      >
        <App>{children}</App>
      </ConfigProvider>
    </AntdRegistry>
  );
}
