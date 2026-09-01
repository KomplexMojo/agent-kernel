// Runs the configuration-permutation-matrix.mjs scenarios through the real CLI and classifies
// each result. Shells out to `node packages/adapters-cli/src/cli/ak.mjs` directly rather than
// through MCP tool calls — this is scripted batch automation, which
// packages/adapters-cli/src/mcp/README.md's own "Mental Model" section calls out as the right
// case for using the CLI directly ("ad hoc shell usage... scripting outside an MCP client").
//
// Two modes:
//   --dry-run    `ak create --dry-run` only (authoring-layer validation, no artifacts written,
//                no `ak run` follow-on). Fast; good for a quick check after touching authoring
//                code.
//   (default)    `ak create` (real artifacts) + `ak run --ticks <N> --seed <N>` per scenario that
//                created successfully. Reaches the layer where the real bugs this matrix has found
//                so far actually live (see mcp-harness-run-through.md, "Configuration-permutation
//                sweep").
//
// Usage:
//   node scripts/testing/run-configuration-permutation-sweep.mjs [--dry-run] [--ticks N] [--seed N]
//
// acceptedActions/emittedEffects counts are recorded as INFORMATIONAL metadata only, never as a
// pass/fail signal — treating "an actor did nothing" as itself suspect is exactly the
// false-positive this matrix's own history already hit once (issue #146, closed: the actor had in
// fact acted correctly — see mcp-harness-run-through.md finding 5). This sweep looks for crashes
// and malformed output, not for "did the actor do something the axis under test doesn't actually
// motivate it to do."

import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MATRIX } from "./configuration-permutation-matrix.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const OUT_ROOT = resolve(ROOT, "artifacts/matrix-sweep");

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const TICKS = Number(args[args.indexOf("--ticks") + 1] ?? 5) || 5;
const SEED = Number(args[args.indexOf("--seed") + 1] ?? 0) || 0;

function buildCreateArgv(scenario, outDir) {
  const { args: a } = scenario;
  const argv = ["create", "--run-id", scenario.id, "--budget-tokens", String(a.budgetTokens)];
  if (DRY_RUN) {
    argv.push("--dry-run");
  } else {
    argv.push("--out-dir", outDir);
  }
  for (const r of a.room || []) argv.push("--room", r);
  for (const d of a.delver || []) argv.push("--delver", d);
  for (const w of a.warden || []) argv.push("--warden", w);
  for (const h of a.hazard || []) argv.push("--hazard", h);
  for (const r of a.resource || []) argv.push("--resource", r);
  return argv;
}

function buildRunArgv(scenario, createOutDir, runOutDir) {
  return [
    "run",
    "--sim-config", `${createOutDir}/sim-config.json`,
    "--initial-state", `${createOutDir}/initial-state.json`,
    "--ticks", String(TICKS),
    "--seed", String(SEED),
    "--run-id", scenario.id,
    "--out-dir", runOutDir,
  ];
}

function classify(combinedText, status, parsed) {
  if (status === 0 && parsed?.ok === true) return { verdict: "PASS", detail: null };
  if (/Budget receipt denied/.test(combinedText)) {
    return { verdict: "EXPECTED_BUDGET_DENIAL", detail: combinedText.trim().slice(0, 500) };
  }
  // Recognized validation-rejection phrasing. Every scenario in the matrix uses values pulled
  // directly from the domain-constants enums, so a validation rejection here is still worth a
  // look (it would mean the matrix itself has an invalid combo) but is a cheaper triage bucket
  // than a raw crash or a malformed message (see #148 — a real "rejection" that still lands in
  // ANOMALY_UNEXPECTED below because its text is broken, not because the rejection is wrong).
  if (/must be one of|is required|is not supported|invalid;? expected/.test(combinedText)) {
    return { verdict: "VALIDATION_REJECTION", detail: combinedText.trim().slice(0, 500) };
  }
  if (status === 0 && parsed?.ok === false) {
    return { verdict: "ANOMALY_OK_FALSE", detail: combinedText.trim().slice(0, 500) };
  }
  return { verdict: "ANOMALY_UNEXPECTED", detail: combinedText.trim().slice(0, 1000) };
}

function runStep(argv) {
  const proc = spawnSync(process.execPath, [CLI, ...argv], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 30_000,
  });
  const stdout = proc.stdout || "";
  const stderr = proc.stderr || "";
  let parsed = null;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    // not JSON
  }
  const { verdict, detail } = classify(`${stdout}\n${stderr}`, proc.status, parsed);
  return { verdict, detail, parsed };
}

function summarizeTickFrames(runOutDir) {
  const framesPath = `${runOutDir}/tick-frames.json`;
  if (!existsSync(framesPath)) return null;
  try {
    const frames = JSON.parse(readFileSync(framesPath, "utf8"));
    let actionsAccepted = 0;
    let effectsEmitted = 0;
    for (const f of frames) {
      actionsAccepted += (f.acceptedActions || []).length;
      effectsEmitted += (f.emittedEffects || []).length;
    }
    return { actionsAccepted, effectsEmitted, frameCount: frames.length };
  } catch {
    return null;
  }
}

rmSync(OUT_ROOT, { recursive: true, force: true });
mkdirSync(OUT_ROOT, { recursive: true });

const results = [];
for (const scenario of MATRIX) {
  const base = resolve(OUT_ROOT, "runs", scenario.id);
  const createOutDir = resolve(base, "create");
  const runOutDir = resolve(base, "run");

  const create = runStep(buildCreateArgv(scenario, createOutDir));

  let run = { verdict: DRY_RUN ? "SKIPPED_DRY_RUN" : "SKIPPED_CREATE_FAILED", detail: null };
  let runInfo = null;
  if (!DRY_RUN && create.verdict === "PASS") {
    run = runStep(buildRunArgv(scenario, createOutDir, runOutDir));
    if (run.verdict === "PASS") {
      runInfo = summarizeTickFrames(runOutDir);
    }
  }

  results.push({
    id: scenario.id,
    axis: scenario.axis,
    description: scenario.description,
    createVerdict: create.verdict,
    createDetail: create.verdict === "PASS" ? null : create.detail,
    runVerdict: run.verdict,
    runDetail: ["PASS", "SKIPPED_CREATE_FAILED", "SKIPPED_DRY_RUN"].includes(run.verdict) ? null : run.detail,
    runInfo,
  });

  const runInfoText = runInfo ? `actions=${runInfo.actionsAccepted} effects=${runInfo.effectsEmitted}` : "";
  process.stdout.write(
    `${scenario.id.padEnd(45)} create=${create.verdict.padEnd(24)} run=${run.verdict.padEnd(24)} ${runInfoText}\n`,
  );
}

const createSummary = results.reduce((acc, r) => {
  acc[r.createVerdict] = (acc[r.createVerdict] || 0) + 1;
  return acc;
}, {});
const runSummary = results.reduce((acc, r) => {
  acc[r.runVerdict] = (acc[r.runVerdict] || 0) + 1;
  return acc;
}, {});

const resultsPath = resolve(OUT_ROOT, `results-${DRY_RUN ? "dry-run" : "full"}.json`);
writeFileSync(resultsPath, JSON.stringify({ mode: DRY_RUN ? "dry-run" : "full", ticks: TICKS, seed: SEED, total: results.length, createSummary, runSummary, results }, null, 2));

console.log("\n--- create summary ---");
console.log(JSON.stringify(createSummary, null, 2));
if (!DRY_RUN) {
  console.log("\n--- run summary ---");
  console.log(JSON.stringify(runSummary, null, 2));
}
console.log(`\nfull results: ${resultsPath}`);

const anomalies = results.filter((r) => r.createVerdict.startsWith("ANOMALY") || r.runVerdict.startsWith("ANOMALY"));
if (anomalies.length > 0) {
  console.log(`\n--- ${anomalies.length} anomalies ---`);
  for (const a of anomalies) {
    console.log(`\n${a.id} (${a.description}):`);
    if (a.createDetail) console.log(`  create: ${a.createDetail}`);
    if (a.runDetail) console.log(`  run: ${a.runDetail}`);
  }
  process.exitCode = 1;
}
