import { runAdaptiveWorkflow } from "../../packages/runtime/src/adaptive-workflow/runner.js";

// Partial-credit score by the furthest phase a run reached. `complete` is a full
// pass; earlier terminal phases score proportionally so a summary distinguishes
// "the model never produced parseable output" from "it validated but failed verify".
const PHASE_SCORE = Object.freeze({
  complete: 100, verify: 80, execute: 60, repair: 45, validate: 40,
  configure: 20, plan: 10, intake: 0, failed: 0, cancelled: 0,
});

// Content validator: each required key must be a NON-EMPTY array. This is
// deliberately stricter than the CLI's presence-only `workflowValidator`, because
// the flagship LLM-session sanitizer fabricates the required keys as empty
// defaults — a presence check would mark garbage output as complete and make the
// benchmark meaningless. Non-empty arrays are what the model actually has to
// produce, so this gate reflects real output quality.
export function workflowValidator(requiredKeys = []) {
  return {
    id: "agent-benchmark-content",
    version: 1,
    validate(value) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { ok: false, issues: [{ path: "/", code: "workflow_output_invalid", message: "Output is not an object" }] };
      }
      const bad = requiredKeys
        .filter((key) => !Array.isArray(value[key]) || value[key].length === 0)
        .map((key) => `/${key}`);
      return bad.length
        ? { ok: false, issues: bad.map((path) => ({ path, code: "workflow_output_invalid", message: "Required workflow output is missing or empty" })) }
        : { ok: true };
    },
  };
}

export function buildCapability(modelName, overrides = {}) {
  return {
    schemaVersion: 1,
    providerId: overrides.providerId || "ollama",
    modelId: modelName,
    source: "declared",
    contextWindowTokens: overrides.contextWindowTokens || 65536,
    maxOutputTokens: overrides.maxOutputTokens || 4096,
    supports: {
      textGeneration: true,
      structuredOutput: overrides.structuredOutput !== false,
      streaming: false,
    },
  };
}

// A real wall clock so capture timing reflects true model latency. (The shipped
// CLI injects a constant clock, which measures 0ms — useless for benchmarking.)
const wallClock = () => new Date().toISOString();

function scoreFor(outcome, phaseReached) {
  if (outcome === "complete") return 100;
  return PHASE_SCORE[phaseReached] ?? 0;
}

export async function runAgentBenchmark({
  scenarios,
  modelFactory,
  modelName = "fixture",
  runs = 1,
  capabilityOverrides = {},
  clock = wallClock,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!Array.isArray(scenarios) || scenarios.length === 0) throw new Error("runAgentBenchmark requires a non-empty scenarios array");
  if (typeof modelFactory !== "function") throw new Error("runAgentBenchmark requires a modelFactory(scenario, run) => modelPort");
  const totalRuns = Math.max(1, runs);
  const results = [];

  for (const scenario of scenarios) {
    for (let run = 1; run <= totalRuns; run += 1) {
      const record = {
        scenarioId: scenario.id,
        title: scenario.title,
        run,
        outcome: "error",
        phaseReached: "intake",
        score: 0,
        latencyMs: null,
        validations: null,
        strategyId: null,
        failureCategory: null,
        failureCode: null,
        producedResponse: false,
        error: null,
      };
      try {
        // A scenario may supply a custom content validator (structured
        // constraints); otherwise fall back to the non-empty-array check.
        const validator = typeof scenario.validate === "function"
          ? { id: `scenario-${scenario.id}`, version: 1, validate: scenario.validate }
          : workflowValidator(scenario.requiredKeys || []);
        const result = await runAdaptiveWorkflow({
          objective: scenario.objective,
          runId: `${scenario.id}_r${run}`,
          declaredCapability: buildCapability(modelName, { ...capabilityOverrides, ...(scenario.capability || {}) }),
          model: modelName,
          // Budget + catalog route the local-sectional strategy through the budget loop.
          ...(Number.isFinite(scenario.budgetTokens) ? { budgetTokens: scenario.budgetTokens } : {}),
          ...(scenario.catalog ? { catalog: scenario.catalog } : {}),
          ports: {
            model: modelFactory(scenario, run),
            validator: [validator],
            clock,
          },
        });
        record.outcome = result.outcome;
        record.phaseReached = result.state?.phase ?? "intake";
        record.score = scoreFor(result.outcome, record.phaseReached);
        record.latencyMs = result.metrics?.latency?.totalMs ?? null;
        record.validations = result.metrics?.validations ?? null;
        record.strategyId = result.metrics?.selectedStrategy?.strategyId ?? result.selectedStrategy?.strategyId ?? null;
        record.failureCategory = result.failure?.category ?? null;
        record.failureCode = result.failure?.code ?? null;
        record.producedResponse = (result.metrics?.responses?.count ?? 0) > 0 || (result.captures?.length ?? 0) > 0;
      } catch (error) {
        record.outcome = "error";
        record.error = error?.message ? String(error.message) : String(error);
      }
      results.push(record);
    }
  }

  return { generatedAt, model: modelName, results, aggregate: aggregate(results, modelName) };
}

function aggregate(results, modelName) {
  const total = results.length;
  const complete = results.filter((r) => r.outcome === "complete").length;
  const responded = results.filter((r) => r.producedResponse).length;
  const scenarios = new Set(results.map((r) => r.scenarioId)).size;
  const avgScore = total ? Math.round(results.reduce((sum, r) => sum + r.score, 0) / total) : 0;
  return {
    model: modelName,
    scenarios,
    runs: total,
    avgScore,
    execOk: { pass: complete, total },
    toolCallOk: { pass: responded, total },
  };
}

// Renders a summary.md whose "Aggregate by Profile" table is byte-compatible with
// the M10 benchmark-evidence loader, so agent runs can feed policy promotion.
export function renderSummary(report, { route = "external", profile = "agent", generatedAt } = {}) {
  const at = generatedAt || report.generatedAt;
  const agg = report.aggregate;
  const lines = [
    "# AdaptiveWorkflowAgent Benchmark Summary",
    "",
    `Generated: ${at}`,
    `Route: ${route}`,
    `Profiles: ${profile}`,
    `Scenarios: ${agg.scenarios}`,
    "",
    "## Aggregate by Profile",
    "",
    "| Profile | Model | Scenarios | Runs | Avg score | Tool call ok | Exec ok |",
    "|---|---|---|---|---|---|---|",
    `| ${profile} | ${agg.model} | ${agg.scenarios} | ${agg.runs} | ${agg.avgScore} | ${agg.toolCallOk.pass}/${agg.toolCallOk.total} | ${agg.execOk.pass}/${agg.execOk.total} |`,
    "",
    "## All Runs",
    "",
    "| Scenario | Run | Outcome | Phase | Score | Strategy | Latency ms | Failure |",
    "|---|---|---|---|---|---|---|---|",
    ...report.results.map((r) => `| ${r.scenarioId} | ${r.run} | ${r.outcome} | ${r.phaseReached} | ${r.score} | ${r.strategyId ?? ""} | ${r.latencyMs ?? ""} | ${r.failureCode ?? r.error ?? ""} |`),
    "",
  ];
  return lines.join("\n");
}
