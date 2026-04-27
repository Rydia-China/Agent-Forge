"use client";

import { useState, useEffect } from "react";
import { Drawer, Select, Spin, Empty, Card, Typography, Image } from "antd";
import { useCostumePreview } from "../hooks/useCostumePreview";

const { Title, Text, Paragraph } = Typography;

interface CostumePreviewDrawerProps {
  open: boolean;
  onClose: () => void;
  novelId: string;
  scriptId: string | null;
}

export function CostumePreviewDrawer({
  open,
  onClose,
  novelId,
  scriptId,
}: CostumePreviewDrawerProps) {
  const [styleName, setStyleName] = useState("update_portrait_style");
  const { costumes, loading, error } = useCostumePreview(novelId, scriptId, styleName);

  if (!scriptId) {
    return (
      <Drawer
        title="换装预览"
        placement="right"
        width={600}
        onClose={onClose}
        open={open}
      >
        <Empty description="请先选择一个 EP" />
      </Drawer>
    );
  }

  return (
    <Drawer
      title="换装预览"
      placement="right"
      width={600}
      onClose={onClose}
      open={open}
    >
      <div style={{ marginBottom: 16 }}>
        <Text strong>风格预设：</Text>
        <Select
          value={styleName}
          onChange={setStyleName}
          style={{ width: "100%", marginTop: 8 }}
          options={[
            { label: "更新角色着装", value: "update_portrait_style" },
          ]}
        />
      </div>

      {loading && (
        <div style={{ textAlign: "center", padding: 40 }}>
          <Spin size="large" />
        </div>
      )}

      {error && (
        <div style={{ color: "red", marginBottom: 16 }}>
          错误: {error}
        </div>
      )}

      {!loading && !error && costumes.length === 0 && (
        <Empty description="该 EP 没有换装数据" />
      )}

      {!loading && !error && costumes.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {costumes.map((costume) => (
            <Card key={costume.characterName} size="small">
              <Title level={5}>{costume.characterName}</Title>

              {costume.portraitUrl && (
                <div style={{ marginBottom: 12 }}>
                  <Text type="secondary">参考立绘：</Text>
                  <div style={{ marginTop: 8 }}>
                    <Image
                      src={costume.portraitUrl}
                      alt={costume.characterName}
                      width={120}
                      height={120}
                      style={{ objectFit: "cover", borderRadius: 4 }}
                    />
                  </div>
                </div>
              )}

              <div style={{ marginBottom: 12 }}>
                <Text type="secondary">换装描述：</Text>
                <Paragraph
                  style={{
                    marginTop: 4,
                    padding: 8,
                    background: "#f5f5f5",
                    borderRadius: 4,
                    fontSize: 12,
                  }}
                >
                  {costume.outfitDesc}
                </Paragraph>
              </div>

              <div>
                <Text type="secondary">编译后 Prompt：</Text>
                <Paragraph
                  style={{
                    marginTop: 4,
                    padding: 8,
                    background: "#e6f7ff",
                    borderRadius: 4,
                    fontSize: 12,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {costume.compiledPrompt}
                </Paragraph>
              </div>
            </Card>
          ))}
        </div>
      )}
    </Drawer>
  );
}
