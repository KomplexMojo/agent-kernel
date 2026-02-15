#!/usr/bin/env node

import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runLlmBudgetLoop } from "../packages/runtime/src/personas/orchestrator/llm-budget-loop.js";

const DEFAULT_SWEEP = Object.freeze([
  { totalBudgetTokens: 1_000_000, runs: 3 },
  { totalBudgetTokens: 2_000_000, runs: 2 },
  { totalBudgetTokens: 5_000_000, runs: 1 },
  { totalBudgetTokens: 10_000_000, runs: 1 },
  { totalBudgetTokens: 20_000_000, runs: 1 },
]);
const DEFAULT_LAYOUT_PERCENT = 55;
const DEFAULT_CATALOG_PATH = "tests/fixtures/pool/catalog-basic.json";
const DEFAULT_POOL_WEIGHTS = Object.freeze([
  { id: "player", weight: 20 },
  { id: "layout", weight: 55 },
  { id: "defenders", weight: 25 },
  { id: "loot", weight: 0 },
]);

function printUsage() {
  console.log(`Usage: node scripts/level-generation-benchmark.mjs [options]

Options:
  --budgets <csv>          Comma-separated total token budgets
                           (default: 1000000,2000000,5000000,10000000,20000000)
  --runs <n>               Run count per budget (overrides default sweep run counts)
  --layout-percent <n>     Layout/walkability allocation percentage (default: 55)
  --catalog <path>         Catalog fixture path (default: tests/fixtures/pool/catalog-basic.json)
  --json                   Emit JSON only
  --help                   Show usage

Examples:
  node scripts/level-generation-benchmark.mjs
  node scripts/level-generation-benchmark.mjs --budgets 1000000,2000000,5000000 --runs 2 --json
`);
}

function parsePositiveInt(value) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseBudgetsCsv(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const entries = value
    .split(",")
    .map((token) => parsePositiveInt(token.trim()))
    .filter((token) => Number.isInteger(token));
  if (entries.length === 0) return null;
  return Array.from(new Set(entries));
}

function parseArgs(argv) {
  const args = {
    budgets: null,
    runs: null,
    layoutPercent: DEFAULT_LAYOUT_PERCENT,
    catalogPath: DEFAULT_CATALOG_PATH,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--budgets") {
      args.budgets = parseBudgetsCsv(argv[i + 1]);
      i += 1;
    } else if (token === "--runs") {
      args.runs = parsePositiveInt(argv[i + 1]);
      i += 1;
    } else if (token === "--layout-percent") {
      const parsed = Number(argv[i + 1]);
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) {
        args.layoutPercent = parsed;
      }
      i += 1;
    } else if (token === "--catalog") {
      args.catalogPath = argv[i + 1];
      i += 1;
    } else if (token === "--json") {
      args.json = true;
    } else if (token === "--help" || token === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  const index = Math.min(sorted.length - 1, Math.max(0, rank));
  return sorted[index];
}

function formatMs(value) {
  return Number.isFinite(value) ? Number(value.toFixed(3)) : null;
}

function summarizeDurations(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    return {
      avg: null,
      p50: null,
      p95: null,
      min: null,
      max: null,
    };
  }
  const sum = samples.reduce((acc, value) => acc + value, 0);
  return {
    avg: formatMs(sum / samples.length),
    p50: formatMs(percentile(samples, 50)),
    p95: formatMs(percentile(samples, 95)),
    min: formatMs(Math.min(...samples)),
    max: formatMs(Math.max(...samples)),
  };
}

async function runSingleBenchmark({ catalog, totalBudgetTokens, layoutPercent, runIndex }) {
  const expectedWalkabilityBudget = Math.floor((totalBudgetTokens * layoutPercent) / 100);
  let adapterCalls = 0;
  const adapter = {
    async generate() {
      adapterCalls += 1;
      return {
        response: JSON.stringify({
          phase: "layout_only",
          remainingBudgetTokens: expectedWalkabilityBudget,
          layout: {
            floorTiles: expectedWalkabilityBudget,
            hallwayTiles: 0,
          },
          missing: [],
          stop: "done",
        }),
        done: true,
      };
    },
  };

  const started = performance.now();
  const result = await runLlmBudgetLoop({
    adapter,
    model: "fixture",
    catalog,
    goal: "Level generation walkability benchmark",
    budgetTokens: totalBudgetTokens,
    poolWeights: DEFAULT_POOL_WEIGHTS,
    runId: `benchmark_walkability_${totalBudgetTokens}_${runIndex}`,
    maxActorRounds: 0,
  });
  const elapsedMs = performance.now() - started;
  const walkableTiles = (result.summary?.layout?.floorTiles || 0) + (result.summary?.layout?.hallwayTiles || 0);
  return {
    ok: result.ok === true,
    elapsedMs,
    adapterCalls,
    walkableTiles,
    expectedWalkabilityBudget,
    poolWalkabilityBudget: result.poolBudgets?.layout,
    errorCodes: Array.isArray(result.errors) ? result.errors.map((entry) => entry?.code).filter(Boolean) : [],
  };
}

function buildSweep(args) {
  if (Array.isArray(args.budgets) && args.budgets.length > 0) {
    return args.budgets.map((totalBudgetTokens) => ({
      totalBudgetTokens,
      runs: Number.isInteger(args.runs) ? args.runs : 1,
    }));
  }
  if (Number.isInteger(args.runs)) {
    return DEFAULT_SWEEP.map((entry) => ({
      totalBudgetTokens: entry.totalBudgetTokens,
      runs: args.runs,
    }));
  }
  return DEFAULT_SWEEP.map((entry) => ({ ...entry }));
}

function printTable(rows, { layoutPercent } = {}) {
  const header = [
    "total_budget",
    "walkability_budget",
    "runs",
    "ok_runs",
    "avg_ms",
    "p95_ms",
    "max_ms",
  ];
  const lines = [header.join("\t")];
  rows.forEach((row) => {
    lines.push([
      row.totalBudgetTokens,
      row.walkabilityBudgetTokens,
      row.runs,
      row.successRuns,
      row.latencyMs.avg ?? "n/a",
      row.latencyMs.p95 ?? "n/a",
      row.latencyMs.max ?? "n/a",
    ].join("\t"));
  });
  console.log(`# level-generation benchmark (layout=${layoutPercent}%)`);
  console.log(lines.join("\n"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }
  const sweep = buildSweep(args);
  const catalogPath = resolve(args.catalogPath);
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));

  const rows = [];
  for (const entry of sweep) {
    const durations = [];
    const failures = [];
    let successRuns = 0;
    for (let runIndex = 0; runIndex < entry.runs; runIndex += 1) {
      try {
        const bench = await runSingleBenchmark({
          catalog,
          totalBudgetTokens: entry.totalBudgetTokens,
          layoutPercent: args.layoutPercent,
          runIndex,
        });
        durations.push(bench.elapsedMs);
        if (bench.ok) {
          successRuns += 1;
        } else {
          failures.push({
            runIndex,
            errorCodes: bench.errorCodes,
          });
        }
      } catch (error) {
        failures.push({
          runIndex,
          error: error?.message || String(error),
        });
      }
    }
    rows.push({
      totalBudgetTokens: entry.totalBudgetTokens,
      walkabilityBudgetTokens: Math.floor((entry.totalBudgetTokens * args.layoutPercent) / 100),
      runs: entry.runs,
      successRuns,
      failureRuns: entry.runs - successRuns,
      latencyMs: summarizeDurations(durations),
      failures: failures.length > 0 ? failures : undefined,
    });
  }

  const successful = rows.filter((row) => row.successRuns > 0);
  const maxSuccessful = successful.length > 0
    ? successful.reduce((best, row) => (
      !best || row.totalBudgetTokens > best.totalBudgetTokens ? row : best
    ), null)
    : null;

  const report = {
    generatedAt: new Date().toISOString(),
    layoutPercent: args.layoutPercent,
    sweep: rows,
    maxSuccessful: maxSuccessful
      ? {
        totalBudgetTokens: maxSuccessful.totalBudgetTokens,
        walkabilityBudgetTokens: maxSuccessful.walkabilityBudgetTokens,
      }
      : null,
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  printTable(rows, { layoutPercent: args.layoutPercent });
  console.log(`max successful total budget: ${report.maxSuccessful?.totalBudgetTokens ?? "n/a"}`);
  console.log(`max successful walkability budget: ${report.maxSuccessful?.walkabilityBudgetTokens ?? "n/a"}`);
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exitCode = 1;
});
