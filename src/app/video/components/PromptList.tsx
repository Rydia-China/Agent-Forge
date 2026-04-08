"use client";

import { Button, Empty, Spin, Tag, Typography } from "antd";
import { ArrowLeftOutlined, ReloadOutlined } from "@ant-design/icons";
import type { PromptListItem, PromptDetail } from "../hooks/usePrompts";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface PromptListProps {
  prompts: PromptListItem[];
  isLoading: boolean;
  selectedPrompt: PromptDetail | null;
  onSelectPrompt: (name: string) => void;
  onRefresh: () => void;
  onBack: () => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function PromptList({
  prompts,
  isLoading,
  selectedPrompt,
  onSelectPrompt,
  onRefresh,
  onBack,
}: PromptListProps) {
  const sorted = [...prompts].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <aside className="flex h-full w-52 shrink-0 flex-col border-r border-slate-800 bg-slate-950/80">
      {/* Header */}
      <div className="border-b border-slate-800 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Button
              type="text"
              size="small"
              icon={<ArrowLeftOutlined />}
              onClick={onBack}
              style={{ width: 28, height: 28, minWidth: 28 }}
            />
            <Typography.Text strong style={{ fontSize: 18 }}>
              Prompts
            </Typography.Text>
            {prompts.length > 0 && (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {prompts.length}
              </Typography.Text>
            )}
          </div>
          <Button
            type="text"
            size="small"
            icon={<ReloadOutlined />}
            loading={isLoading}
            onClick={onRefresh}
            style={{ width: 22, height: 22, minWidth: 22 }}
          />
        </div>
      </div>

      {/* Prompt list */}
      <div className="flex-1 overflow-y-auto p-2">
        {isLoading && prompts.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Spin size="small" />
          </div>
        ) : sorted.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="No prompts"
            style={{ margin: "12px 0" }}
          />
        ) : (
          <div className="space-y-1">
            {sorted.map((p) => {
              const isActive = selectedPrompt?.name === p.name;
              const isProduction = p.labels?.includes("production");
              return (
                <button
                  key={p.name}
                  type="button"
                  className={`w-full rounded border px-2.5 py-2 text-left transition ${
                    isActive
                      ? "border-amber-400/60 bg-amber-500/10"
                      : "border-slate-800 bg-slate-900/40 hover:border-slate-600"
                  }`}
                  onClick={() => onSelectPrompt(p.name)}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate text-xs font-medium text-slate-100">
                      {p.name}
                    </span>
                    {isProduction && (
                      <Tag
                        color="green"
                        style={{ fontSize: 14, lineHeight: "22px", margin: 0, padding: "0 6px" }}
                      >
                        prod
                      </Tag>
                    )}
                  </div>
                  {p.versions && p.versions.length > 0 && (
                    <div className="mt-0.5 text-sm text-slate-500">
                      {p.versions.length} version{p.versions.length > 1 ? "s" : ""}
                    </div>
                  )}
                  {p.tags && p.tags.length > 0 && (
                    <div className="mt-0.5 flex flex-wrap gap-0.5">
                      {p.tags.slice(0, 3).map((t) => (
                        <span key={t} className="rounded bg-slate-800 px-1 text-sm text-slate-400">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
