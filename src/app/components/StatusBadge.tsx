"use client";

import { Badge } from "antd";
import {
  LoadingOutlined,
  ExclamationCircleFilled,
  CheckCircleFilled,
  CloseCircleFilled,
} from "@ant-design/icons";

export type AgentStatus = "idle" | "running" | "needs_attention" | "done" | "error";

export function StatusBadge({ status }: { status: AgentStatus }) {
  switch (status) {
    case "idle":
      return <Badge status="default" />;
    case "running":
      return <LoadingOutlined style={{ color: "#52c41a", fontSize: 12 }} spin />;
    case "needs_attention":
      return <ExclamationCircleFilled style={{ color: "#faad14", fontSize: 12 }} />;
    case "done":
      return <CheckCircleFilled style={{ color: "#52c41a", fontSize: 12 }} />;
    case "error":
      return <CloseCircleFilled style={{ color: "#ff4d4f", fontSize: 12 }} />;
  }
}
