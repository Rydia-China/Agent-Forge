import type { AssertionResult, Trace, TraceAssertions, PathAssertion, ReplyAssertion, StructuralAssertion, ExpectedTool, ToolCorrectnessConfig } from "../types.js";

/** Resolve a dot-path on an object. Supports array indexing: "items[0].key" */
function resolvePath(obj: unknown, path: string): unknown {
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Evaluate a single path assertion on a trace. */
function evalPathAssertion(trace: Trace, a: PathAssertion, category: "outcome" | "path"): AssertionResult {
  switch (a.type) {
    case "tool_called": {
      const found = trace.toolCalls?.find((tc) => tc.name === a.tool);
      return {
        category,
        type: "tool_called",
        pass: !!found,
        detail: found ? `${a.tool} called at position ${trace.toolCalls!.indexOf(found)}` : `${a.tool} was not called`,
      };
    }
    case "tool_not_called": {
      const found = trace.toolCalls?.find((tc) => tc.name === a.tool);
      return {
        category,
        type: "tool_not_called",
        pass: !found,
        detail: found ? `${a.tool} was unexpectedly called` : `${a.tool} correctly absent`,
      };
    }
    case "tool_called_with": {
      const found = trace.toolCalls?.find((tc) => tc.name === a.tool);
      if (!found) {
        return { category, type: "tool_called_with", pass: false, detail: `${a.tool} was not called` };
      }
      if (!a.args) {
        return { category, type: "tool_called_with", pass: true, detail: `${a.tool} called (no arg check)` };
      }
      return { category, type: "tool_called_with", pass: true, detail: `${a.tool} called (arg check skipped in trace mode)` };
    }
    case "sequence": {
      if (!a.tools?.length) return { category, type: "sequence", pass: true, detail: "empty sequence" };
      const callNames = trace.toolCalls?.map((tc) => tc.name) ?? [];
      let lastIdx = -1;
      let allFound = true;
      for (const tool of a.tools) {
        const idx = callNames.indexOf(tool, lastIdx + 1);
        if (idx === -1) { allFound = false; break; }
        lastIdx = idx;
      }
      return {
        category,
        type: "sequence",
        pass: allFound,
        detail: allFound
          ? `Sequence ${a.tools.join(" → ")} found in order`
          : `Sequence broken: ${a.tools.join(" → ")} not found in order. Actual: ${callNames.join(", ")}`,
      };
    }
    case "max_tool_calls": {
      const count = trace.toolCalls?.length ?? 0;
      const pass = count <= (a.value ?? Infinity);
      return {
        category,
        type: "max_tool_calls",
        pass,
        detail: `${count} tool calls (max: ${a.value})`,
      };
    }
    case "max_iterations": {
      const iters = trace.iterations ?? 1;
      const pass = iters <= (a.value ?? Infinity);
      return {
        category,
        type: "max_iterations",
        pass,
        detail: `${iters} iterations (max: ${a.value})`,
      };
    }
    case "resource_created": {
      const found = trace.toolCalls?.some((tc) =>
        tc.name.includes("generate_image") || tc.name.includes("generate_video"),
      );
      return {
        category,
        type: "resource_created",
        pass: !!found,
        detail: found ? "Resource generation tool was called" : "No resource generation tool called",
      };
    }
    default:
      return { category, type: a.type, pass: false, detail: `Unknown assertion type: ${a.type}` };
  }
}

/** Evaluate reply assertions. For unit mode, falls back to unitResult.raw. */
function evalReplyAssertion(trace: Trace, a: ReplyAssertion): AssertionResult {
  const reply = trace.reply ?? trace.unitResult?.raw ?? "";
  switch (a.type) {
    case "contains_any": {
      const found = a.values.find((v) => reply.includes(v));
      return {
        category: "reply",
        type: "contains_any",
        pass: !!found,
        detail: found ? `Reply contains "${found}"` : `Reply missing all of: ${a.values.join(", ")}`,
      };
    }
    case "not_contains": {
      const found = a.values.find((v) => reply.includes(v));
      return {
        category: "reply",
        type: "not_contains",
        pass: !found,
        detail: found ? `Reply unexpectedly contains "${found}"` : "Reply correctly excludes forbidden terms",
      };
    }
  }
}

/** Evaluate structural assertions on unit result parsed JSON. */
function evalStructuralAssertion(trace: Trace, a: StructuralAssertion): AssertionResult {
  const data = trace.unitResult?.parsed;
  if (data == null) {
    return {
      category: "structural",
      type: `path:${a.path}`,
      pass: false,
      detail: "No parsed data available",
    };
  }

  const value = resolvePath(data, a.path);
  let pass = false;
  let detail = "";

  switch (a.op) {
    case ">=":
      pass = typeof value === "number" && value >= (a.value as number);
      detail = `${a.path} = ${value} (expected >= ${a.value})`;
      break;
    case "<=":
      pass = typeof value === "number" && value <= (a.value as number);
      detail = `${a.path} = ${value} (expected <= ${a.value})`;
      break;
    case "==":
      pass = value === a.value;
      detail = `${a.path} = ${JSON.stringify(value)} (expected == ${JSON.stringify(a.value)})`;
      break;
    case "contains":
      pass = typeof value === "string" && value.includes(a.value as string);
      detail = `${a.path} ${pass ? "contains" : "does not contain"} "${a.value}"`;
      break;
    case "matches":
      pass = typeof value === "string" && new RegExp(a.value as string).test(value);
      detail = `${a.path} ${pass ? "matches" : "does not match"} /${a.value}/`;
      break;
  }

  return { category: "structural", type: `${a.op}:${a.path}`, pass, detail };
}

/**
 * Run all deterministic assertions against a trace.
 * Does NOT include semantic (judge) or consistency (multi-run) assertions.
 */
export function runAssertions(trace: Trace, assertions: TraceAssertions): AssertionResult[] {
  const results: AssertionResult[] = [];

  for (const a of assertions.outcome ?? []) {
    results.push(evalPathAssertion(trace, a, "outcome"));
  }

  for (const a of assertions.path ?? []) {
    results.push(evalPathAssertion(trace, a, "path"));
  }

  for (const a of assertions.reply ?? []) {
    results.push(evalReplyAssertion(trace, a));
  }

  for (const a of assertions.structural ?? []) {
    results.push(evalStructuralAssertion(trace, a));
  }

  return results;
}

/** Standard DP longest common subsequence length. */
function lcsLength(a: string[], b: string[]): number {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return dp[a.length][b.length];
}

/**
 * Compute a tool correctness score across three dimensions:
 *   selection (Jaccard), ordering (LCS-based), and parameter matching.
 */
export function evalToolCorrectness(
  trace: Trace,
  expectedTools: ExpectedTool[],
  config: ToolCorrectnessConfig,
): AssertionResult {
  // --- Selection Score (Jaccard similarity) ---
  const expectedNames = new Set(expectedTools.map((t) => t.name));
  const actualNames = new Set((trace.toolCalls ?? []).map((tc) => tc.name));
  const intersection = new Set([...expectedNames].filter((n) => actualNames.has(n)));
  const union = new Set([...expectedNames, ...actualNames]);
  const selection = union.size === 0 ? 1.0 : intersection.size / union.size;

  // --- Ordering Score (LCS-based) ---
  const expectedSeq = expectedTools.map((t) => t.name);
  const actualSeq = (trace.toolCalls ?? []).map((tc) => tc.name);
  const lcs = lcsLength(expectedSeq, actualSeq);
  const ordering = expectedSeq.length === 0 ? 1.0 : lcs / expectedSeq.length;

  // --- Parameter Match Score ---
  const toolsWithArgs = expectedTools.filter((t) => t.args != null);
  let parameters: number;
  if (toolsWithArgs.length === 0) {
    parameters = 1.0;
  } else {
    let totalParamMatch = 0;
    for (const expected of toolsWithArgs) {
      const actual = (trace.toolCalls ?? []).find((tc) => tc.name === expected.name);
      const expectedKeys = Object.keys(expected.args!);
      if (expectedKeys.length === 0) {
        totalParamMatch += 1.0;
        continue;
      }
      if (!actual) {
        totalParamMatch += 0;
        continue;
      }
      let matchedKeys = 0;
      for (const key of expectedKeys) {
        if (
          key in actual.args &&
          JSON.stringify(actual.args[key]) === JSON.stringify(expected.args![key])
        ) {
          matchedKeys++;
        }
      }
      totalParamMatch += matchedKeys / expectedKeys.length;
    }
    parameters = totalParamMatch / toolsWithArgs.length;
  }

  // --- Combined Score ---
  const weights = {
    selection: config.weights?.selection ?? 0.4,
    ordering: config.weights?.ordering ?? 0.3,
    parameters: config.weights?.parameters ?? 0.3,
  };
  const combined =
    weights.selection * selection +
    weights.ordering * ordering +
    weights.parameters * parameters;
  const pass = combined >= (config.threshold ?? 0.7);

  return {
    category: "tool_correctness",
    type: "tool_correctness",
    pass,
    detail: `score=${combined.toFixed(2)} (sel=${selection.toFixed(2)} ord=${ordering.toFixed(2)} param=${parameters.toFixed(2)})`,
    evidence: { combined, selection, ordering, parameters },
  };
}
