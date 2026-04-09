/* ------------------------------------------------------------------ */
/*  Trace — the universal output of every eval run                     */
/* ------------------------------------------------------------------ */

export interface TraceToolCall {
  callId: string;
  name: string;
  args: Record<string, unknown>;
  result: string;
  durationMs: number;
  iteration: number;
  error?: string;
}

export interface TraceUnitResult {
  raw: string;
  parsed?: unknown;
  validated: boolean;
  attempts: number;
  schemaErrors?: string[];
}

export interface Trace {
  caseFile: string;
  mode: CaseMode;
  runIndex: number;
  timestamp: string;
  input: {
    message: string;
    model?: string;
    skills?: string[];
    videoContext?: Record<string, unknown>;
  };
  unitResult?: TraceUnitResult;
  toolCalls?: TraceToolCall[];
  reply?: string;
  iterations?: number;
  totalDurationMs: number;
}

/* ------------------------------------------------------------------ */
/*  Case definitions                                                   */
/* ------------------------------------------------------------------ */

export type CaseMode = "unit" | "trace" | "workflow" | "regression";
export type CaseTier = "capability" | "regression";

export interface StructuralAssertion {
  path: string;
  op: ">=" | "<=" | "==" | "contains" | "matches";
  value: unknown;
}

export interface ConsistencyAssertion {
  path: string;
  max_std_dev?: number;
  min_avg_length?: number;
}

export interface SemanticConfig {
  model?: string;
  mode?: "direct" | "g-eval";
  rubric: string;
  pass_threshold: number;
}

export interface PathAssertion {
  type: string;
  tool?: string;
  tools?: string[];
  args?: Record<string, unknown>;
  value?: number;
  values?: string[];
  reason?: string;
  key?: string;
  pattern?: string;
}

export interface ReplyAssertion {
  type: "contains_any" | "not_contains";
  values: string[];
}

export interface ToolCorrectnessConfig {
  weights?: { selection?: number; ordering?: number; parameters?: number };
  threshold?: number;  // minimum combined score to pass, default 0.7
}

export interface TaskCompletionConfig {
  threshold?: number;  // 0.0-1.0, default 0.7
  model?: string;
}

export interface ExpectedTool {
  name: string;
  args?: Record<string, unknown>;
}

export interface TraceAssertions {
  outcome?: PathAssertion[];
  path?: PathAssertion[];
  reply?: ReplyAssertion[];
  structural?: StructuralAssertion[];
  consistency?: ConsistencyAssertion[];
  semantic?: SemanticConfig;
  tool_correctness?: ToolCorrectnessConfig;
  task_completion?: TaskCompletionConfig;
}

export interface UnitInput {
  prompt?: string;
  langfuse?: { name: string; variables?: Record<string, string> };
  model: string;
  outputSchema?: Record<string, unknown>;
  maxRetries?: number;
}

export interface TraceInput {
  message: string;
  skills?: string[];
  video_context?: {
    novelId: string;
    scriptId: string;
    scriptKey: string;
  };
}

export interface WorkflowStep {
  message: string;
  assertions: TraceAssertions;
}

export interface RegressionTolerance {
  tool_count_delta?: number;
  allow_extra_tools?: string[];
  required_tools?: string[];
}

export interface EvalCase {
  name: string;
  description: string;
  mode: CaseMode;
  tags: string[];
  tier: CaseTier;
  runs: number;
  input?: UnitInput | TraceInput;
  expected_tools?: ExpectedTool[];
  context?: { video_context?: Record<string, unknown>; skills?: string[] };
  steps?: WorkflowStep[];
  golden?: string;
  tolerance?: RegressionTolerance;
  assertions?: TraceAssertions;
}

/* ------------------------------------------------------------------ */
/*  Assertion results                                                  */
/* ------------------------------------------------------------------ */

export interface AssertionResult {
  category: "outcome" | "path" | "reply" | "structural" | "consistency" | "semantic" | "tool_correctness" | "task_completion";
  type: string;
  pass: boolean;
  detail: string;
  evidence?: unknown;
}

/* ------------------------------------------------------------------ */
/*  Judge result                                                       */
/* ------------------------------------------------------------------ */

export interface JudgeResult {
  score: number;
  pass: boolean;
  issues: string[];
  reasoning: string;
}

/* ------------------------------------------------------------------ */
/*  Stats                                                              */
/* ------------------------------------------------------------------ */

export interface ToolCorrectnessStats {
  mean: number;
  stdDev: number;
  min: number;
  max: number;
  selection: { mean: number };
  ordering: { mean: number };
  parameters: { mean: number };
}

export interface CaseStats {
  runs: number;
  passRate: number;
  passAtK: number;
  passExpK: number;
  semanticScores?: {
    mean: number;
    stdDev: number;
    min: number;
    max: number;
    distribution: Record<number, number>;
  };
  ci95: { lower: number; upper: number };
  consistency?: Record<string, { mean: number; stdDev: number; pass: boolean }>;
  timing: { mean: number; min: number; max: number };
  toolStats?: {
    totalCalls: number;
    successCount: number;
    failCount: number;
    successRate: number;
    avgDurationMs: number;
    byTool: Record<string, { total: number; errors: number; successRate: number }>;
  };
  toolCorrectness?: ToolCorrectnessStats;
}

/* ------------------------------------------------------------------ */
/*  Summary report                                                     */
/* ------------------------------------------------------------------ */

export interface CaseSummary {
  name: string;
  file: string;
  tier: CaseTier;
  runs: number;
  passRate: number;
  passAtK: number;
  passExpK: number;
  ci95: { lower: number; upper: number };
  avgScore?: number;
  avgToolCorrectness?: number;
  avgDurationMs: number;
  status: "pass" | "fail";
  failureSummary?: string;
  toolStats?: CaseStats["toolStats"];
}

export interface DimensionBreakdown {
  cases: number;
  passRate: number;
  ci95: { lower: number; upper: number };
}

export interface TierSummary {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
}

export interface EvalSummary {
  evalId: string;
  mode: CaseMode;
  timestamp: string;
  filter: string | null;
  tags: string[] | null;
  totalCases: number;
  byTier: { capability: TierSummary; regression: TierSummary };
  passed: number;
  failed: number;
  passRate: number;
  totalRuns: number;
  totalDurationMs: number;
  cases: CaseSummary[];
  toolStats?: CaseStats["toolStats"];
  dimensionBreakdown?: Record<string, DimensionBreakdown>;
}

/* ------------------------------------------------------------------ */
/*  Diff metadata                                                      */
/* ------------------------------------------------------------------ */

export interface DiffFileEntry {
  path: string;
  diffFile: string;
  snapshotFile: string;
}

export interface DiffMetadata {
  id: string;
  createdAt: string;
  description: string;
  reason: string;
  triggeredBy?: { evalId: string; failedCases: string[] };
  files: DiffFileEntry[];
  status: "pending" | "applied" | "reverted";
  appliedAt?: string;
  verifiedBy?: {
    evalId: string;
    beforePassRate: number;
    afterPassRate: number;
    beforeAvgScore?: number;
    afterAvgScore?: number;
  } | null;
}
