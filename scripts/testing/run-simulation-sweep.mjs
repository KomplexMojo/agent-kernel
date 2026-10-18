#!/usr/bin/env node
/**
 * Simulation sweep: runs the core and sweep scenario catalogues and reports every rule
 * violation and each scenario's metrics, compared with the previous sweep. It never fails
 * on a rule or a metric (the core set's rules already gate `pnpm run test`); it exits
 * non-zero only when it cannot run at all.
 *
 *   pnpm run sim:sweep                          # core + sweep, compared with the last report
 *   pnpm run sim:sweep -- --catalogue core      # one catalogue
 *   pnpm run sim:sweep -- --only duel-fire-water
 *   pnpm run sim:sweep -- --out-dir artifacts/simulations --concurrency 4
 *
 * Writes <out-dir>/report.json, <out-dir>/report.md and <out-dir>/previous-report.json
 * (the report it compared against). Default out-dir: artifacts/simulations.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ROOT, RULES, checkRules, compareWithKnown, loadScenarios, runScenarios } from "./simulation-lib.mjs";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const catalogues = option("catalogue", "core,sweep").split(",");
const only = option("only", null);
const outDir = resolve(ROOT, option("out-dir", "artifacts/simulations"));
const concurrency = Number(option("concurrency", 4));

// A metric moving by more than this share (or appearing/disappearing) is called out.
const CHANGE_THRESHOLD = 0.25;
const METRICS = ["firstExit", "exited", "defeated", "healthLost", "casts", "moves", "acceptRate"];

const scenarios = catalogues.flatMap((name) => loadScenarios(name).map((scenario) => ({ ...scenario, catalogue: name })))
  .filter((scenario) => !only || scenario.id === only);
if (scenarios.length === 0) {
  console.error(`sim:sweep: no scenarios matched (catalogues ${catalogues.join(", ")}${only ? `, only ${only}` : ""}).`);
  process.exit(1);
}

const started = Date.now();
const results = await runScenarios(scenarios, { concurrency });
const report = {
  createdAt: new Date().toISOString(),
  seconds: Math.round((Date.now() - started) / 100) / 10,
  scenarios: scenarios.map((scenario, index) => {
    const violations = checkRules(scenario, results[index]);
    const { unexpected, fixed } = compareWithKnown(scenario, violations);
    return {
      id: scenario.id,
      catalogue: scenario.catalogue,
      note: scenario.note,
      metrics: results[index].metrics ?? null,
      violations,
      unexpected,
      knownFixed: fixed,
    };
  }),
};

const reportPath = join(outDir, "report.json");
const previousPath = join(outDir, "previous-report.json");
mkdirSync(outDir, { recursive: true });
let previous = null;
if (existsSync(reportPath)) {
  copyFileSync(reportPath, previousPath);
  previous = JSON.parse(readFileSync(previousPath, "utf8"));
}
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

function metricChanges(current, before) {
  if (!current || !before) return [];
  return METRICS.flatMap((name) => {
    const now = current[name];
    const then = before[name];
    if (now === then) return [];
    if (now === null || then === null || then === 0) return [`${name} ${then} → ${now}`];
    return Math.abs(now - then) / Math.abs(then) > CHANGE_THRESHOLD ? [`${name} ${then} → ${now}`] : [];
  });
}

const lines = [`# Simulation sweep`, "", `${report.createdAt} · ${scenarios.length} scenarios · ${report.seconds}s`
  + (previous ? ` · compared with ${previous.createdAt}` : " · no previous report"), ""];
const unexpected = report.scenarios.filter((entry) => entry.unexpected.length > 0);
const fixedKnown = report.scenarios.filter((entry) => entry.knownFixed.length > 0);
lines.push("## Rules", "");
if (unexpected.length === 0 && fixedKnown.length === 0) lines.push("No new violations; every known issue still reproduces.", "");
for (const entry of unexpected) {
  const byRule = new Map();
  for (const violation of entry.unexpected) {
    const list = byRule.get(violation.rule) ?? [];
    list.push(violation);
    byRule.set(violation.rule, list);
  }
  for (const [rule, list] of byRule) {
    const actors = [...new Set(list.map((violation) => violation.actor).filter(Boolean))];
    const sample = list.find((violation) => violation.detail)?.detail;
    lines.push(`- **${entry.id}** (${entry.catalogue}): ${rule} — ${RULES[rule]}`
      + `${actors.length ? `; ${actors.slice(0, 6).join(", ")}${actors.length > 6 ? ` +${actors.length - 6}` : ""}` : ""}`
      + `${sample ? ` (e.g. ${sample})` : ""}`);
  }
}
for (const entry of fixedKnown) {
  for (const known of entry.knownFixed) lines.push(`- **${entry.id}**: known ${known.rule} (${known.issue}) no longer happens`);
}
lines.push("", "## Metric changes", "");
const byId = new Map((previous?.scenarios ?? []).map((entry) => [entry.id, entry]));
let changed = 0;
for (const entry of report.scenarios) {
  const changes = metricChanges(entry.metrics, byId.get(entry.id)?.metrics);
  if (changes.length) {
    changed += 1;
    lines.push(`- **${entry.id}**: ${changes.join(", ")}`);
  }
}
if (!previous) lines.push("No previous report to compare with.");
else if (changed === 0) lines.push(`No metric moved by more than ${CHANGE_THRESHOLD * 100}%.`);
lines.push("", "## Metrics", "", "| scenario | first exit | exited | defeated | health lost | casts | moves | accept rate | violations |",
  "|---|---|---|---|---|---|---|---|---|");
for (const entry of report.scenarios) {
  const m = entry.metrics ?? {};
  lines.push(`| ${entry.id} | ${m.firstExit ?? "–"} | ${m.exited ?? "–"} | ${m.defeated ?? "–"} | ${m.healthLost ?? "–"} | `
    + `${m.casts ?? "–"} | ${m.moves ?? "–"} | ${m.acceptRate ?? "–"} | ${entry.violations.map((v) => v.rule).join(", ") || "–"} |`);
}
writeFileSync(join(outDir, "report.md"), `${lines.join("\n")}\n`);
console.log(lines.slice(0, lines.indexOf("## Metrics")).join("\n"));
console.log(`\nFull report: ${join(outDir, "report.md")}`);
