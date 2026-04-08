"use client";

import type { LlmStats } from "./hooks/useTaskStream";
import { MODEL_OPTIONS } from "../../lib/agent/models";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Format token count in M (millions). */
function fmtM(n: number): string {
  return (n / 1_000_000).toFixed(2) + "M";
}

function pct(a: number, b: number): string {
  if (b <= 0) return "—";
  return (a / b * 100).toFixed(1) + "%";
}

/** Estimate cost in USD based on model pricing, accounting for cache reads.
 *  Note: Anthropic proxy reports promptTokens as uncached-only input tokens,
 *  so we use promptTokens directly as the uncached portion. */
function calcCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
  cacheReadTokens: number,
): number {
  const m = MODEL_OPTIONS.find((o) => o.id === model);
  if (!m) return 0;
  const cachePrice = m.cacheReadPricePerM ?? m.inputPricePerM;
  return (promptTokens / 1_000_000) * m.inputPricePerM
       + (cacheReadTokens / 1_000_000) * cachePrice
       + (completionTokens / 1_000_000) * m.outputPricePerM;
}

function fmtCost(usd: number): string {
  if (usd < 0.01) return "$" + usd.toFixed(4);
  return "$" + usd.toFixed(2);
}

/* ------------------------------------------------------------------ */
/*  Row                                                                */
/* ------------------------------------------------------------------ */

function Row({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-[2px]">
      <span className="text-slate-500">{label}</span>
      <span className={`font-mono ${warn ? "text-red-300" : "text-slate-300"}`}>
        {value}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  LlmStatsBar — fixed bottom-left badge + hover popup               */
/* ------------------------------------------------------------------ */

export function LlmStatsBar({ stats }: { stats: LlmStats }) {
  // Don't render until we have at least one LLM call
  if (stats.llmCalls === 0 && stats.toolCallCount === 0) return null;

  const contextPct =
    stats.maxContextTokens > 0
      ? stats.lastPromptTokens / stats.maxContextTokens
      : 0;
  const contextWarn = contextPct > 0.7;

  const hasErrors = stats.toolErrorCount > 0;
  const cost = calcCost(stats.model, stats.totalPromptTokens, stats.totalCompletionTokens, stats.totalCacheReadTokens);
  const totalInput = stats.totalPromptTokens + stats.totalCacheReadTokens;
  const cacheHitPct = totalInput > 0
    ? stats.totalCacheReadTokens / totalInput
    : 0;

  // Badge color: red if context > 70% or has tool errors, otherwise neutral
  const badgeColor =
    contextWarn || hasErrors
      ? "bg-red-900/60 text-red-300 border-red-800/50"
      : "bg-slate-900/90 text-slate-400 border-slate-700/60";

  return (
    <div className="group fixed bottom-3 left-3 z-50">
      {/* Badge (always visible) */}
      <div
        className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm font-mono shadow-lg backdrop-blur-sm cursor-default select-none ${badgeColor}`}
      >
        <span className="text-sm">◉</span>
        <span>{fmtM(stats.totalTokens)}</span>
        <span className="text-slate-600">|</span>
        <span className="text-emerald-400">{fmtCost(cost)}</span>
        <span className="text-slate-600">|</span>
        <span>r{stats.llmCalls}</span>
      </div>

      {/* Hover popup — pb-1.5 keeps hover zone contiguous between card & badge */}
      <div className="absolute bottom-full left-0 hidden w-72 pb-1.5 group-hover:block">
        <div className="rounded-lg border border-slate-700/60 bg-slate-900/95 shadow-xl backdrop-blur-sm">
        <div className="px-3 py-2 text-sm">
          {/* Section: Tokens & Cost */}
          <div className="mb-1.5 text-sm font-semibold uppercase tracking-wider text-slate-600">
            Tokens
          </div>
          <Row label="Prompt" value={fmtM(stats.totalPromptTokens)} />
          <Row label="Completion" value={fmtM(stats.totalCompletionTokens)} />
          <Row label="Total" value={fmtM(stats.totalTokens)} />
          <Row
            label="Context usage"
            value={`${fmtM(stats.lastPromptTokens)} / ${fmtM(stats.maxContextTokens)} (${pct(stats.lastPromptTokens, stats.maxContextTokens)})`}
            warn={contextWarn}
          />
          <Row label="LLM rounds" value={String(stats.llmCalls)} />
          <Row
            label="Cache hit"
            value={`${fmtM(stats.totalCacheReadTokens)} / ${fmtM(stats.totalPromptTokens)} (${pct(stats.totalCacheReadTokens, stats.totalPromptTokens)})`}
          />
          <Row label="Est. cost" value={fmtCost(cost)} />

          {/* Section: Tools */}
          <div className="mb-1.5 mt-2.5 text-sm font-semibold uppercase tracking-wider text-slate-600">
            Tools
          </div>
          <Row
            label="Calls"
            value={`${stats.toolSuccessCount} ok / ${stats.toolErrorCount} err / ${stats.toolCallCount} total`}
            warn={hasErrors}
          />
          <Row
            label="Success rate"
            value={stats.toolCallCount > 0 ? pct(stats.toolSuccessCount, stats.toolCallCount) : "—"}
            warn={hasErrors}
          />

          {/* Section: Subagent (conditional) */}
          {stats.subagentCallCount > 0 && (
            <>
              <div className="mb-1.5 mt-2.5 text-sm font-semibold uppercase tracking-wider text-slate-600">
                Subagent
              </div>
              <Row label="Calls" value={String(stats.subagentCallCount)} />
              <Row
                label="Error rate"
                value={pct(stats.subagentErrorCount, stats.subagentCallCount)}
                warn={stats.subagentErrorCount > 0}
              />
            </>
          )}

          {/* Model */}
          {stats.model && (
            <div className="mt-2 border-t border-slate-800 pt-1.5 text-sm text-slate-600">
              {stats.model}
            </div>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}
