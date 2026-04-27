"use client";

import { useState, useCallback } from "react";
import {
  Drawer, Spin, Empty, Typography, Input, Button, Collapse, Tag, App, Image,
} from "antd";
import { CheckOutlined, EditOutlined, UserOutlined, EnvironmentOutlined } from "@ant-design/icons";
import { usePromptPreview } from "../hooks/usePromptPreview";
import type { CharacterPreview, ScenePreview } from "../hooks/usePromptPreview";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface PromptPreviewDrawerProps {
  open: boolean;
  onClose: () => void;
  novelId: string;
}

/* ------------------------------------------------------------------ */
/*  Inline editable field                                              */
/* ------------------------------------------------------------------ */

function EditableField({
  label,
  value,
  onSave,
  isSaving,
}: {
  label: string;
  value: string | null;
  onSave: (v: string) => void;
  isSaving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const startEdit = () => {
    setDraft(value ?? "");
    setEditing(true);
  };

  const handleSave = () => {
    onSave(draft);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="mt-1">
        <div className="mb-0.5 text-[11px] text-slate-500">{label}</div>
        <div className="flex gap-1">
          <Input.TextArea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoSize={{ minRows: 2, maxRows: 6 }}
            className="!text-xs !bg-slate-800 !text-slate-200"
          />
          <div className="flex flex-col gap-0.5">
            <Button
              type="primary"
              size="small"
              icon={<CheckOutlined />}
              loading={isSaving}
              onClick={handleSave}
              style={{ width: 28, height: 28, minWidth: 28 }}
            />
            <Button
              size="small"
              onClick={() => setEditing(false)}
              style={{ width: 28, height: 28, minWidth: 28, fontSize: 10 }}
            >
              ✕
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group/field mt-1 flex items-start gap-1">
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 text-[11px] text-slate-500">{label}</div>
        <div className="text-xs leading-relaxed text-slate-300 whitespace-pre-wrap">
          {value || <span className="text-slate-600 italic">empty</span>}
        </div>
      </div>
      <Button
        type="text"
        size="small"
        icon={<EditOutlined />}
        onClick={startEdit}
        className="mt-3 shrink-0 opacity-0 transition-opacity group-hover/field:opacity-100 !text-slate-500 hover:!text-blue-400"
        style={{ width: 22, height: 22, minWidth: 22, fontSize: 11 }}
      />
    </div>
  );
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
/*  Character card                                                     */
/* ------------------------------------------------------------------ */

function CharacterCard({
  char,
  isSaving,
  onUpdateField,
}: {
  char: CharacterPreview;
  isSaving: boolean;
  onUpdateField: (name: string, field: string, value: string) => void;
}) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
      <div className="flex items-center gap-2">
        {char.portraitUrl ? (
          <Image
            src={char.portraitUrl}
            alt={char.name}
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
        <Typography.Text strong className="!text-sm">{char.name}</Typography.Text>
        <div className="flex gap-1 ml-auto">
          {char.gender && <Tag style={{ fontSize: 10, margin: 0, lineHeight: "16px" }}>{char.gender}</Tag>}
          {char.age && <Tag style={{ fontSize: 10, margin: 0, lineHeight: "16px" }}>{char.age}</Tag>}
        </div>
      </div>

      <EditableField
        label="appearance"
        value={char.appearance}
        isSaving={isSaving}
        onSave={(v) => onUpdateField(char.name, "appearance", v)}
      />

      <CompiledPrompt prompt={char.compiledPrompt} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Scene card                                                         */
/* ------------------------------------------------------------------ */

function SceneCard({
  scene,
  isChild,
  isSaving,
  onUpdateField,
}: {
  scene: ScenePreview;
  isChild: boolean;
  isSaving: boolean;
  onUpdateField: (
    target: "location" | "sub_location",
    name: string,
    field: string,
    value: string,
    parentName?: string,
  ) => void;
}) {
  const target = isChild ? "sub_location" as const : "location" as const;

  return (
    <div className={`rounded-lg border border-slate-800 bg-slate-900/50 p-3 ${isChild ? "ml-3 border-l-2 border-l-blue-500/30" : ""}`}>
      <div className="flex items-center gap-2">
        {scene.imageUrl ? (
          <Image
            src={scene.imageUrl}
            alt={scene.name}
            width={48}
            height={32}
            className="rounded object-cover"
            style={{ width: 48, height: 32 }}
            preview={{ mask: false }}
          />
        ) : (
          <div className="flex h-8 w-12 shrink-0 items-center justify-center rounded bg-slate-800">
            <EnvironmentOutlined className="text-slate-500 text-[10px]" />
          </div>
        )}
        <Typography.Text strong className="!text-xs">{scene.name}</Typography.Text>
        {scene.mode === "grid" && (
          <Tag color="purple" style={{ fontSize: 9, margin: 0, lineHeight: "14px", padding: "0 4px" }}>
            宫格
          </Tag>
        )}
        {scene.mode === "hd" && (
          <Tag color="blue" style={{ fontSize: 9, margin: 0, lineHeight: "14px", padding: "0 4px" }}>
            HD
          </Tag>
        )}
        {scene.mode === "single" && (
          <Tag style={{ fontSize: 9, margin: 0, lineHeight: "14px", padding: "0 4px" }}>
            单场景
          </Tag>
        )}
      </div>

      <EditableField
        label="visual_prompt"
        value={scene.visualPrompt}
        isSaving={isSaving}
        onSave={(v) => onUpdateField(target, scene.name, "visual_prompt", v, scene.parentName ?? undefined)}
      />

      <CompiledPrompt prompt={scene.compiledPrompt} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Drawer                                                        */
/* ------------------------------------------------------------------ */

export function PromptPreviewDrawer({ open, onClose, novelId }: PromptPreviewDrawerProps) {
  const { message } = App.useApp();
  const preview = usePromptPreview(novelId);

  const handleCharUpdate = useCallback(
    (name: string, field: string, value: string) => {
      void preview.updateField("character", name, field, value).catch((err: unknown) => {
        void message.error(err instanceof Error ? err.message : "Update failed");
      });
    },
    [preview, message],
  );

  const handleSceneUpdate = useCallback(
    (
      target: "location" | "sub_location",
      name: string,
      field: string,
      value: string,
      parentName?: string,
    ) => {
      void preview.updateField(target, name, field, value, parentName).catch((err: unknown) => {
        void message.error(err instanceof Error ? err.message : "Update failed");
      });
    },
    [preview, message],
  );

  /* ---- Group scenes by parent ---- */
  const sceneGroups: Array<{ parent: ScenePreview; children: ScenePreview[] }> = [];
  const standaloneScenes: ScenePreview[] = [];

  if (preview.data) {
    const parentMap = new Map<string, { parent: ScenePreview; children: ScenePreview[] }>();
    for (const s of preview.data.scenes) {
      if (!s.parentName) {
        const group = { parent: s, children: [] as ScenePreview[] };
        parentMap.set(s.name, group);
        sceneGroups.push(group);
      }
    }
    for (const s of preview.data.scenes) {
      if (s.parentName) {
        const group = parentMap.get(s.parentName);
        if (group) {
          group.children.push(s);
        } else {
          standaloneScenes.push(s);
        }
      }
    }
  }

  const charCount = preview.data?.characters.length ?? 0;
  const sceneCount = preview.data?.scenes.length ?? 0;

  return (
    <Drawer
      title="Prompt Preview"
      open={open}
      onClose={onClose}
      size="large"
      styles={{ body: { padding: "12px 16px", background: "rgb(2 6 23)" } }}
    >
      {preview.isLoading && !preview.data ? (
        <div className="flex items-center justify-center py-20">
          <Spin />
        </div>
      ) : !preview.data ? (
        <Empty description="无数据" />
      ) : (
        <Collapse
          defaultActiveKey={["characters", "scenes"]}
          ghost
          size="small"
          items={[
            {
              key: "characters",
              label: (
                <span className="flex items-center gap-1.5 text-xs font-medium">
                  <UserOutlined /> 角色立绘
                  <Tag style={{ fontSize: 10, lineHeight: "16px", margin: 0 }}>{charCount}</Tag>
                  {preview.isLoading && <Spin size="small" />}
                </span>
              ),
              children: (
                <div className="space-y-2">
                  {preview.data.characters.map((c) => (
                    <CharacterCard
                      key={c.name}
                      char={c}
                      isSaving={preview.isSaving}
                      onUpdateField={handleCharUpdate}
                    />
                  ))}
                </div>
              ),
            },
            {
              key: "scenes",
              label: (
                <span className="flex items-center gap-1.5 text-xs font-medium">
                  <EnvironmentOutlined /> 场景
                  <Tag style={{ fontSize: 10, lineHeight: "16px", margin: 0 }}>{sceneCount}</Tag>
                  {preview.isLoading && <Spin size="small" />}
                </span>
              ),
              children: (
                <div className="space-y-2">
                  {sceneGroups.map((g) => (
                    <div key={g.parent.name} className="space-y-1.5">
                      <SceneCard
                        scene={g.parent}
                        isChild={false}
                        isSaving={preview.isSaving}
                        onUpdateField={handleSceneUpdate}
                      />
                      {g.children.map((child) => (
                        <SceneCard
                          key={child.name}
                          scene={child}
                          isChild
                          isSaving={preview.isSaving}
                          onUpdateField={handleSceneUpdate}
                        />
                      ))}
                    </div>
                  ))}
                  {standaloneScenes.map((s) => (
                    <SceneCard
                      key={s.name}
                      scene={s}
                      isChild={false}
                      isSaving={preview.isSaving}
                      onUpdateField={handleSceneUpdate}
                    />
                  ))}
                </div>
              ),
            },
          ]}
        />
      )}
    </Drawer>
  );
}
