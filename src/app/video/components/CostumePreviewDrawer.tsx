"use client";

import { Drawer, Spin, Empty, Typography, Collapse, Tag, Image } from "antd";
import { UserOutlined } from "@ant-design/icons";
import { useCostumePreview } from "../hooks/useCostumePreview";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface CostumePreviewDrawerProps {
  open: boolean;
  onClose: () => void;
  novelId: string;
  scriptId: string | null;
}

/* ------------------------------------------------------------------ */
/*  Compiled prompt display                                            */
/* ------------------------------------------------------------------ */

function CompiledPrompt({ prompt }: { prompt: string | null }) {
  if (!prompt) {
    return (
      <div className="mt-2 rounded bg-slate-800/50 px-2.5 py-1.5 text-[11px] text-slate-500 italic">
        编译结果待生成
      </div>
    );
  }

  return (
    <div className="mt-2">
      <div className="mb-0.5 text-[11px] text-slate-500">编译结果</div>
      <pre className="whitespace-pre-wrap rounded bg-slate-800/60 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-200/80 font-mono">
        {prompt}
      </pre>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Costume card                                                       */
/* ------------------------------------------------------------------ */

function CostumeCard({
  costume,
}: {
  costume: {
    characterName: string;
    outfitDesc: string;
    compiledPrompt: string;
    portraitUrl: string | null;
  };
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
      <div className="flex items-center gap-2">
        {costume.portraitUrl ? (
          <Image
            src={costume.portraitUrl}
            alt={costume.characterName}
            width={40}
            height={40}
            className="rounded-full object-cover"
            style={{ width: 40, height: 40 }}
            preview={{ mask: false }}
          />
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-800">
            <UserOutlined className="text-slate-500" />
          </div>
        )}
        <Typography.Text strong className="!text-sm">{costume.characterName}</Typography.Text>
      </div>

      <div className="mt-1">
        <div className="mb-0.5 text-[11px] text-slate-500">outfit_desc</div>
        <div className="text-xs leading-relaxed text-slate-300 whitespace-pre-wrap">
          {costume.outfitDesc || <span className="text-slate-600 italic">empty</span>}
        </div>
      </div>

      <CompiledPrompt prompt={costume.compiledPrompt} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Drawer                                                        */
/* ------------------------------------------------------------------ */

export function CostumePreviewDrawer({ open, onClose, novelId, scriptId }: CostumePreviewDrawerProps) {
  const { costumes, loading, error } = useCostumePreview(novelId, scriptId);

  const costumeCount = costumes.length;

  return (
    <Drawer
      title="Costume Preview"
      open={open}
      onClose={onClose}
      size="large"
      styles={{ body: { padding: "12px 16px", background: "rgb(2 6 23)" } }}
    >
      {loading && !costumes.length ? (
        <div className="flex items-center justify-center py-20">
          <Spin />
        </div>
      ) : error ? (
        <Empty description={error} />
      ) : !scriptId ? (
        <Empty description="请先选择一个 EP" />
      ) : (
        <Collapse
          defaultActiveKey={["costumes"]}
          ghost
          size="small"
          items={[
            {
              key: "costumes",
              label: (
                <span className="flex items-center gap-1.5 text-xs font-medium">
                  <UserOutlined /> 换装
                  <Tag style={{ fontSize: 10, lineHeight: "16px", margin: 0 }}>{costumeCount}</Tag>
                  {loading && <Spin size="small" />}
                </span>
              ),
              children: (
                <div className="space-y-2">
                  {costumes.length === 0 ? (
                    <Empty description="该 EP 没有换装数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  ) : (
                    costumes.map((c) => (
                      <CostumeCard key={c.characterName} costume={c} />
                    ))
                  )}
                </div>
              ),
            },
          ]}
        />
      )}
    </Drawer>
  );
}
