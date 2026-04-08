"use client";

import { useMemo, useState } from "react";
import { Drawer, Button, Tag, Alert, Badge, Typography } from "antd";
import {
  ReloadOutlined,
  RightOutlined,
  DownOutlined,
  ApiOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import type {
  SkillSummary,
  McpSummary,
  BuiltinMcpSummary,
  McpSelection,
} from "../types";

/* ------------------------------------------------------------------ */
/*  Internal node type                                                 */
/* ------------------------------------------------------------------ */

type McpNode = {
  name: string;
  kind: "builtin" | "dynamic";
  active: boolean;
  available: boolean;
  description: string | null;
  skills: SkillSummary[];
  /** dynamic MCPs can open detail editor */
  hasDetail: boolean;
};

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface McpDrawerProps {
  open: boolean;
  skills: SkillSummary[];
  builtinMcps: BuiltinMcpSummary[];
  mcps: McpSummary[];
  isLoadingMcp: boolean;
  error: string | null;
  notice: string | null;
  onLoadMcp: () => void;
  onSelectMcp: (resource: McpSelection) => void;
  onClose: () => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function McpDrawer({
  open,
  skills,
  builtinMcps,
  mcps,
  isLoadingMcp,
  error,
  notice,
  onLoadMcp,
  onSelectMcp,
  onClose,
}: McpDrawerProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (name: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  /* Build MCP tree -------------------------------------------------- */
  const nodes = useMemo(() => {
    const byProvider = new Map<string, SkillSummary[]>();
    for (const s of skills) {
      const list = byProvider.get(s.provider) ?? [];
      list.push(s);
      byProvider.set(s.provider, list);
    }

    const result: McpNode[] = [];

    // "_builtin" virtual provider for system builtin skills
    const builtinSkills = byProvider.get("_builtin") ?? [];
    if (builtinSkills.length > 0) {
      result.push({
        name: "_builtin",
        kind: "builtin",
        active: true,
        available: true,
        description: "系统内置 Skills",
        skills: builtinSkills,
        hasDetail: false,
      });
    }

    // Builtin MCPs (core + catalog)
    for (const m of builtinMcps) {
      result.push({
        name: m.name,
        kind: "builtin",
        active: m.active,
        available: m.available,
        description: null,
        skills: byProvider.get(m.name) ?? [],
        hasDetail: false,
      });
    }

    // Dynamic MCPs
    for (const m of mcps) {
      result.push({
        name: m.name,
        kind: "dynamic",
        active: true,
        available: true,
        description: m.description,
        skills: byProvider.get(m.name) ?? [],
        hasDetail: true,
      });
    }

    return result;
  }, [skills, builtinMcps, mcps]);

  return (
    <Drawer
      title="MCP"
      placement="right"
      styles={{ wrapper: { width: 300 } }}
      open={open}
      onClose={onClose}
      extra={
        <Button
          type="text"
          size="small"
          icon={<ReloadOutlined />}
          loading={isLoadingMcp}
          onClick={onLoadMcp}
        />
      }
    >
      {error && <Alert type="error" title={error} showIcon style={{ marginBottom: 8 }} />}
      {notice && <Alert type="success" title={notice} showIcon style={{ marginBottom: 8 }} />}

      <div className="space-y-1">
        {nodes.map((node) => {
          const isExpanded = expanded.has(node.name);
          const hasChildren = node.skills.length > 0;

          return (
            <div key={node.name}>
              {/* MCP row */}
              <div
                className="flex items-center gap-1.5 rounded px-2 py-1.5 hover:bg-slate-800/60"
                style={{ cursor: hasChildren || node.hasDetail ? "pointer" : "default" }}
                onClick={() => {
                  if (hasChildren) toggle(node.name);
                  else if (node.hasDetail) {
                    onSelectMcp({ type: "mcp", name: node.name });
                    onClose();
                  }
                }}
              >
                {/* Expand arrow */}
                <span style={{ width: 28, display: "inline-flex", alignItems: "center", justifyContent: "center", opacity: hasChildren ? 1 : 0.2 }}>
                  {isExpanded
                    ? <DownOutlined style={{ fontSize: 28 }} />
                    : <RightOutlined style={{ fontSize: 28 }} />}
                </span>

                {/* Icon */}
                {node.kind === "builtin"
                  ? <ThunderboltOutlined style={{ fontSize: 28, color: "#faad14" }} />
                  : <ApiOutlined style={{ fontSize: 28, color: "#1677ff" }} />}

                {/* Name */}
                <Typography.Text
                  ellipsis
                  style={{
                    flex: 1,
                    fontSize: 16,
                    fontWeight: 500,
                    opacity: node.available ? 1 : 0.4,
                    textDecoration: !node.available ? "line-through" : undefined,
                  }}
                  title={node.description ?? node.name}
                >
                  {node.name === "_builtin" ? "系统内置" : node.name}
                </Typography.Text>

                {/* Status dot */}
                {node.kind === "builtin" && node.name !== "_builtin" && (
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      backgroundColor: node.active ? "#52c41a" : node.available ? "#8c8c8c" : "#ff4d4f",
                      flexShrink: 0,
                    }}
                    title={node.active ? "active" : node.available ? "available" : "unavailable"}
                  />
                )}

                {/* Skill count badge */}
                {hasChildren && (
                  <Badge count={node.skills.length} size="small" color="gray" />
                )}

                {/* Detail link for dynamic MCPs */}
                {node.hasDetail && (
                  <Button
                    type="link"
                    size="small"
                    style={{ fontSize: 14, padding: 0, height: "auto", lineHeight: 1 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectMcp({ type: "mcp", name: node.name });
                      onClose();
                    }}
                  >
                    编辑
                  </Button>
                )}
              </div>

              {/* Expanded skill list */}
              {isExpanded && hasChildren && (
                <div className="ml-5 flex flex-wrap gap-1 pb-2 pl-2 pt-1">
                  {node.skills.map((s) => (
                    <Tag
                      key={s.name}
                      color={s.productionVersion > 0 ? "blue" : "green"}
                      style={{ cursor: "pointer", fontSize: 14 }}
                      title={s.description}
                      onClick={() => {
                        onSelectMcp({ type: "skill", name: s.name });
                        onClose();
                      }}
                    >
                      {s.name}
                    </Tag>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {nodes.length === 0 && !isLoadingMcp && (
          <Typography.Text type="secondary" style={{ fontSize: 14 }}>
            No MCP providers loaded.
          </Typography.Text>
        )}
      </div>
    </Drawer>
  );
}
