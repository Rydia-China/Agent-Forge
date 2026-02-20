"use client";

import { Drawer, Button, Tag, Alert, Divider, Typography } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import type {
  SkillSummary,
  McpSummary,
  BuiltinMcpSummary,
  ResourceSelection,
} from "../types";

export interface ResourceDrawerProps {
  open: boolean;
  builtinSkills: SkillSummary[];
  dbSkills: SkillSummary[];
  builtinMcps: BuiltinMcpSummary[];
  mcps: McpSummary[];
  isLoadingResources: boolean;
  error: string | null;
  notice: string | null;
  onLoadResources: () => void;
  onSelectResource: (resource: ResourceSelection) => void;
  onClose: () => void;
}

export function ResourceDrawer({
  open,
  builtinSkills,
  dbSkills,
  builtinMcps,
  mcps,
  isLoadingResources,
  error,
  notice,
  onLoadResources,
  onSelectResource,
  onClose,
}: ResourceDrawerProps) {
  return (
    <Drawer
      title="Resources"
      placement="right"
      width={288}
      open={open}
      onClose={onClose}
      extra={
        <Button
          type="text"
          size="small"
          icon={<ReloadOutlined />}
          loading={isLoadingResources}
          onClick={onLoadResources}
        />
      }
    >
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 8 }} />}
      {notice && <Alert type="success" message={notice} showIcon style={{ marginBottom: 8 }} />}

      <div className="space-y-4">
        <section>
          <Typography.Text type="secondary" style={{ fontSize: 10, textTransform: "uppercase" }}>
            内置 Skills
          </Typography.Text>
          <div className="mt-1 flex flex-wrap gap-1">
            {builtinSkills.map((s) => (
              <Tag
                key={s.name}
                color="green"
                style={{ cursor: "pointer" }}
                title={s.description}
                onClick={() => {
                  onSelectResource({ type: "skill", name: s.name });
                  onClose();
                }}
              >
                {s.name}
              </Tag>
            ))}
          </div>
        </section>

        <section>
          <Typography.Text type="secondary" style={{ fontSize: 10, textTransform: "uppercase" }}>
            内置 MCPs
          </Typography.Text>
          <div className="mt-1 flex flex-wrap gap-1">
            {builtinMcps.map((m) => (
              <Tag
                key={m.name}
                color={m.active ? "green" : m.available ? "default" : undefined}
                style={{
                  cursor: "pointer",
                  ...((!m.active && !m.available) ? { textDecoration: "line-through", opacity: 0.5 } : {}),
                }}
                title={
                  m.active
                    ? `${m.name} (active)`
                    : m.available
                      ? `${m.name} (available)`
                      : `${m.name} (unavailable)`
                }
                onClick={() => {
                  onSelectResource({ type: "mcp", name: m.name });
                  onClose();
                }}
              >
                {m.name}
              </Tag>
            ))}
          </div>
        </section>

        <Divider style={{ margin: "8px 0" }} />

        <section>
          <Typography.Text strong style={{ fontSize: 11 }}>Skills</Typography.Text>
          {dbSkills.length === 0 ? (
            <div className="mt-1">
              <Typography.Text type="secondary" style={{ fontSize: 10 }}>No database skills.</Typography.Text>
            </div>
          ) : (
            <div className="mt-1 flex flex-wrap gap-1">
              {dbSkills.map((s) => (
                <Tag
                  key={s.name}
                  color="green"
                  style={{ cursor: "pointer" }}
                  title={s.description}
                  onClick={() => {
                    onSelectResource({ type: "skill", name: s.name });
                    onClose();
                  }}
                >
                  {s.name}
                </Tag>
              ))}
            </div>
          )}
        </section>

        <section>
          <Typography.Text strong style={{ fontSize: 11 }}>MCPs</Typography.Text>
          {mcps.length === 0 ? (
            <div className="mt-1">
              <Typography.Text type="secondary" style={{ fontSize: 10 }}>No MCP servers.</Typography.Text>
            </div>
          ) : (
            <div className="mt-1 flex flex-wrap gap-1">
              {mcps.map((m) => (
                <Tag
                  key={m.name}
                  style={{ cursor: "pointer" }}
                  title={m.description ?? ""}
                  onClick={() => {
                    onSelectResource({ type: "mcp", name: m.name });
                    onClose();
                  }}
                >
                  {m.name}
                </Tag>
              ))}
            </div>
          )}
        </section>
      </div>
    </Drawer>
  );
}
