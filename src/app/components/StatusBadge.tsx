"use client";

export type AgentStatus = "idle" | "running" | "needs_attention" | "done" | "error";

export function StatusBadge({ status }: { status: AgentStatus }) {
  switch (status) {
    case "idle":
      return <span className="inline-block h-2 w-2 rounded-full bg-slate-500" />;
    case "running":
      return (
        <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin" />
      );
    case "needs_attention":
      return (
        <span className="inline-block text-xs leading-none text-amber-400 animate-pulse">
          ❗
        </span>
      );
    case "done":
      return <span className="inline-block text-xs leading-none text-emerald-400">✅</span>;
    case "error":
      return <span className="inline-block text-xs leading-none text-rose-400">❌</span>;
  }
}
