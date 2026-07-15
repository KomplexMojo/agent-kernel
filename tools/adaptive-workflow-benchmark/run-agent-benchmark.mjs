#!/usr/bin/env node
// Runs the small agent-specific scenario set through the AdaptiveWorkflowAgent
// against a live (Ollama-compatible) model endpoint and writes a summary.md /
// summary.json. The summary.md aggregate table is compatible with the M10
// benchmark-evidence loader.
//
// Usage:
//   node tools/adaptive-workflow-benchmark/run-agent-benchmark.mjs \
//     --base-url http://localhost:21436 --model qwen3-coder:30b-a3b-q4_K_M \
//     --runs 3 --route external --out-dir tools/adaptive-workflow-benchmark/results/<ts>
//   optional: --scenario-ids single-room,two-rooms
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createModelFactory } from "./model-providers.mjs";
import { runAgentBenchmark, renderSummary } from "./agent-benchmark.mjs";
import { AGENT_BENCHMARK_SCENARIOS, AGENT_BENCHMARK_HARD_SCENARIOS } from "./scenarios.mjs";

const SETS = {
  smoke: AGENT_BENCHMARK_SCENARIOS,
  hard: AGENT_BENCHMARK_HARD_SCENARIOS,
  all: [...AGENT_BENCHMARK_SCENARIOS, ...AGENT_BENCHMARK_HARD_SCENARIOS],
};

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) { args[key] = true; } else { args[key] = next; i += 1; }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const provider = typeof args.provider === "string" ? args.provider : "ollama";
  const baseUrl = typeof args["base-url"] === "string" ? args["base-url"] : undefined;
  const endpoint = typeof args.endpoint === "string" ? args.endpoint : undefined;
  if (provider === "ollama" && !baseUrl) {
    process.stderr.write("provider 'ollama' requires --base-url <url> (e.g. an SSH-tunnelled Ollama endpoint)\n");
    process.exit(2);
  }
  const model = typeof args.model === "string" ? args.model : "qwen3-coder:30b-a3b-q4_K_M";
  const runs = Number(args.runs) > 0 ? Number(args.runs) : 1;
  const route = typeof args.route === "string" ? args.route : "external";
  const outDir = typeof args["out-dir"] === "string" ? args["out-dir"] : null;
  const ids = typeof args["scenario-ids"] === "string" ? args["scenario-ids"].split(",").map((s) => s.trim()) : null;
  const setName = typeof args.set === "string" ? args.set : "smoke";
  const set = SETS[setName];
  if (!set) {
    process.stderr.write(`Unknown --set '${setName}'. Use one of: ${Object.keys(SETS).join(", ")}\n`);
    process.exit(2);
  }
  const scenarios = ids ? set.filter((s) => ids.includes(s.id)) : set;
  if (scenarios.length === 0) {
    process.stderr.write(`No scenarios matched --scenario-ids=${args["scenario-ids"]}\n`);
    process.exit(2);
  }

  let modelFactory;
  try {
    modelFactory = createModelFactory({ provider, baseUrl, model, endpoint });
  } catch (error) {
    process.stderr.write(`${error?.message || error}\n`);
    process.exit(2);
  }
  const generatedAt = new Date().toISOString();
  const target = provider === "ollama" ? baseUrl : `${provider} (${endpoint || "default endpoint"})`;
  process.stderr.write(`Running ${scenarios.length} scenario(s) x ${runs} run(s) against ${model} via ${provider} @ ${target} ...\n`);
  const report = await runAgentBenchmark({ scenarios, modelFactory, modelName: model, runs, generatedAt });
  const summaryMd = renderSummary(report, { route, generatedAt });

  const agg = report.aggregate;
  process.stdout.write(`\n${summaryMd}\n`);
  process.stdout.write(`Exec ok: ${agg.execOk.pass}/${agg.execOk.total}  |  Avg score: ${agg.avgScore}  |  Tool-call ok: ${agg.toolCallOk.pass}/${agg.toolCallOk.total}\n`);

  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "summary.md"), summaryMd);
    writeFileSync(join(outDir, "summary.json"), JSON.stringify(report, null, 2));
    process.stderr.write(`Wrote ${join(outDir, "summary.md")} and summary.json\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`agent benchmark failed: ${error?.stack || error}\n`);
  process.exit(1);
});
