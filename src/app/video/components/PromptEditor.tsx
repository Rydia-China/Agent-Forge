"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Checkbox,
  Empty,
  Input,
  Select,
  Spin,
  Tag,
  Typography,
  App,
} from "antd";
import { SaveOutlined, EyeOutlined, EditOutlined } from "@ant-design/icons";
import type { PromptDetail } from "../hooks/usePrompts";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface PromptEditorProps {
  prompt: PromptDetail | null;
  isLoading: boolean;
  versions: PromptDetail[];
  isLoadingVersions: boolean;
  onSelectVersion: (version: number) => void;
  onSave: (
    content: string,
    opts?: { labels?: string[] },
  ) => Promise<PromptDetail>;
  isSaving: boolean;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Extract {{variable}} names from a template string. */
function extractVariables(template: string): string[] {
  const matches = template.matchAll(/\{\{(\w+)\}\}/g);
  const names = new Set<string>();
  for (const m of matches) {
    if (m[1]) names.add(m[1]);
  }
  return [...names];
}

/** Client-side compile: replace {{var}} with values. */
function compileTemplate(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    return key in variables ? variables[key]! : match;
  });
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function PromptEditor({
  prompt,
  isLoading,
  versions,
  isLoadingVersions,
  onSelectVersion,
  onSave,
  isSaving,
}: PromptEditorProps) {
  const { message } = App.useApp();

  /* ---- Editing state ---- */
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [setAsProduction, setSetAsProduction] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);

  /* ---- Mock variables ---- */
  const [mockVars, setMockVars] = useState<Record<string, string>>({});

  /* Sync edit content when prompt changes */
  useEffect(() => {
    if (prompt) {
      setEditContent(prompt.template);
      setEditMode(false);
      setSetAsProduction(false);
    }
  }, [prompt]);

  /* Extract variables from current content */
  const variableNames = useMemo(
    () => extractVariables(editMode ? editContent : prompt?.template ?? ""),
    [editMode, editContent, prompt?.template],
  );

  /* Clean up mock vars when variable list changes */
  useEffect(() => {
    setMockVars((prev) => {
      const next: Record<string, string> = {};
      for (const name of variableNames) {
        next[name] = prev[name] ?? "";
      }
      return next;
    });
  }, [variableNames]);

  /* Compiled preview */
  const compiledPreview = useMemo(() => {
    const tpl = editMode ? editContent : prompt?.template ?? "";
    return compileTemplate(tpl, mockVars);
  }, [editMode, editContent, prompt?.template, mockVars]);

  /* ---- Handlers ---- */
  const handleSave = useCallback(async () => {
    try {
      const labels = setAsProduction ? ["production"] : undefined;
      await onSave(editContent, { labels });
      setEditMode(false);
      void message.success("New version saved");
    } catch (err: unknown) {
      void message.error(
        err instanceof Error ? err.message : "Save failed",
      );
    }
  }, [editContent, setAsProduction, onSave, message]);

  const handleMockVarChange = useCallback(
    (varName: string, value: string) => {
      setMockVars((prev) => ({ ...prev, [varName]: value }));
    },
    [],
  );

  /* ---- Empty state ---- */
  if (!prompt && !isLoading) {
    return (
      <section className="flex min-w-0 flex-1 items-center justify-center">
        <Empty description="Select a prompt from the list" />
      </section>
    );
  }

  if (isLoading) {
    return (
      <section className="flex min-w-0 flex-1 items-center justify-center">
        <Spin size="large" />
      </section>
    );
  }

  if (!prompt) return null;

  /* ---- Version options ---- */
  const versionOptions = versions.map((v) => ({
    value: v.version,
    label: (
      <span>
        v{v.version}
        {v.labels.includes("production") ? " (production)" : ""}
        {v.labels.includes("latest") ? " (latest)" : ""}
      </span>
    ),
  }));

  const hasUnsavedChanges = editMode && editContent !== prompt.template;

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <Typography.Text strong style={{ fontSize: 24 }}>
            {prompt.name}
          </Typography.Text>
          <div className="flex items-center gap-1.5">
            {prompt.labels.map((l) => (
              <Tag
                key={l}
                color={l === "production" ? "green" : l === "latest" ? "blue" : "default"}
                style={{ fontSize: 14, lineHeight: "22px", margin: 0 }}
              >
                {l}
              </Tag>
            ))}
            <Tag style={{ fontSize: 14, lineHeight: "22px", margin: 0 }}>
              {prompt.type}
            </Tag>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Version selector */}
          <Select
            size="small"
            value={prompt.version}
            onChange={onSelectVersion}
            options={versionOptions}
            loading={isLoadingVersions}
            style={{ minWidth: 130 }}
            popupMatchSelectWidth={false}
          />

          {/* Toggle edit/view */}
          <Button
            size="small"
            type={editMode ? "primary" : "default"}
            icon={<EditOutlined />}
            onClick={() => setEditMode(!editMode)}
          >
            {editMode ? "Editing" : "Edit"}
          </Button>

          {/* Toggle preview */}
          <Button
            size="small"
            type={previewMode ? "primary" : "default"}
            icon={<EyeOutlined />}
            onClick={() => setPreviewMode(!previewMode)}
          >
            Preview
          </Button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Template editor / viewer */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {previewMode ? (
            /* Preview panel */
            <div className="flex-1 overflow-y-auto p-4">
              <div className="mb-2 text-xs font-medium text-slate-400 uppercase">
                Compiled Preview
              </div>
              <pre className="whitespace-pre-wrap rounded bg-slate-900 p-4 text-sm leading-relaxed text-slate-200">
                {compiledPreview}
              </pre>
            </div>
          ) : editMode ? (
            /* Edit mode */
            <div className="flex flex-1 flex-col overflow-hidden p-4">
              <Input.TextArea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                autoSize={false}
                className="!flex-1 !resize-none !bg-slate-900 !text-sm !text-slate-200 !font-mono"
                style={{ minHeight: 0 }}
              />
              {/* Save bar */}
              <div className="mt-3 flex items-center gap-3">
                <Checkbox
                  checked={setAsProduction}
                  onChange={(e) => setSetAsProduction(e.target.checked)}
                >
                  <span className="text-xs text-slate-300">
                    Set as production
                  </span>
                </Checkbox>
                <Button
                  type="primary"
                  size="small"
                  icon={<SaveOutlined />}
                  loading={isSaving}
                  disabled={!hasUnsavedChanges && !setAsProduction}
                  onClick={() => void handleSave()}
                >
                  Save as New Version
                </Button>
              </div>
            </div>
          ) : (
            /* Read-only view */
            <div className="flex-1 overflow-y-auto p-4">
              <div className="mb-2 text-xs font-medium text-slate-400 uppercase">
                Template (v{prompt.version})
              </div>
              <pre className="whitespace-pre-wrap rounded bg-slate-900 p-4 text-sm leading-relaxed text-slate-200 font-mono">
                {prompt.template}
              </pre>
            </div>
          )}
        </div>

        {/* Variables sidebar */}
        {variableNames.length > 0 && (
          <div className="w-56 shrink-0 overflow-y-auto border-l border-slate-800 p-3">
            <div className="mb-2 text-xs font-medium text-slate-400 uppercase">
              Variables ({variableNames.length})
            </div>
            <div className="space-y-2">
              {variableNames.map((v) => (
                <div key={v}>
                  <label className="mb-0.5 block text-sm font-mono text-amber-300/80">
                    {`{{${v}}}`}
                  </label>
                  <Input.TextArea
                    size="small"
                    value={mockVars[v] ?? ""}
                    onChange={(e) => handleMockVarChange(v, e.target.value)}
                    placeholder={`mock value for ${v}`}
                    autoSize={{ minRows: 1, maxRows: 4 }}
                    className="!bg-slate-900 !text-xs !text-slate-200"
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
