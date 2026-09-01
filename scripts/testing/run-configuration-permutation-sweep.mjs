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
//
// Step-level assertions (added after the sweep's first coverage review — see
// mcp-harness-run-through.md, "Testing depth"): the whole-run classification above only asks
// "did the run complete." It cannot see a defect present at tick 2 and gone by tick 5 — which is
// exactly the shape #147 was (every tick individually wrong, in a way no aggregate summary would
// ever flag). stepLevelCheck() replays acceptedActions cumulatively tick-by-tick against
// initial-state.json/sim-config.json — the same data ak_show_state's own (correct)
// resolveActorPositionsAtTick() replay is built on — and asserts, at every tick: every accepted
// move landed in-bounds and off a wall tile, no two actors ever occupy the same tile after a
// tick's moves are applied, and every requested tick actually produced exactly one `apply`
// phase-frame (no skipped or duplicated ticks). No extra CLI/MCP calls — it's pure post-processing
// of files the `run` step already writes, so it costs nothing extra at 50-scenario scale.
//
// Determinism/reproducibility check (added investigating whether hazard interaction could be
// tested this way — see mcp-harness-run-through.md, "Hazard interaction — what this sweep found").
// Hazards authored via ak_create/ak_run turned out to be wired through a static affinity FIELD
// (core.armStaticHazardAt / computeStaticHazardAffinityField) that feeds an actor's OBSERVATION —
// internal to core-ts, never written to any file this sweep reads, so its exact effect isn't
// assertable from outside without a core-ts-level test (a different layer than this sweep). What
// *is* assertable from here, and is the real prerequisite for any interaction-specific assertion
// to mean anything: is the simulation reproducible at all. checkDeterminism() re-runs `ak run`
// a second time against the SAME create output (same sim-config.json/initial-state.json, same
// run-id, a separate --out-dir) and deep-compares every artifact the first run produced. The clock
// is seeded from sim-config's own meta.createdAt (createDeterministicClock/resolveClockSeed in
// run-helpers.js), not the wall clock, so the SIMULATION should match exactly — and it does: the
// first run of this check found tick-frames.json/effects-log.json/runtime-decision-captures.json
// byte-identical across all 49 scenarios. It also found three OTHER artifacts
// (action-log.json/run-summary.json/world-state.json) were never reproducible, for a confirmed,
// unrelated reason — their meta.id/meta.createdAt are stamped by the host's wall-clock
// createMeta()/makeId(), not the seeded clock (filed as #149). stripKnownNondeterministicMeta()
// below excludes exactly that field pair so this check measures what it actually set out to
// measure; see #149 for the harness gap itself, tracked and fixed separately.

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
  const argv = [
    "run",
    "--sim-config", `${createOutDir}/sim-config.json`,
    "--initial-state", `${createOutDir}/initial-state.json`,
    "--ticks", String(TICKS),
    "--seed", String(SEED),
    "--run-id", scenario.id,
    "--out-dir", runOutDir,
  ];
  // Run-time-only override, not an authoring input: `--actor id,x,y[,kind]` repositions an
  // already-created actor (create/configure has no x/y field for delver/warden — placement is
  // level-gen's job). Used by axis E's diagonal-warden-placement scenarios to move the
  // auto-placed warden onto a specific corner before ticking, without changing what was authored.
  for (const spec of scenario.args.actorOverride || []) argv.push("--actor", spec);
  return argv;
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

// Per-tick assertions, replayed from files the `run` step already wrote — no extra CLI/MCP calls.
// See the file-header comment for what this checks and why (mirrors #147's shape: correct in
// aggregate, wrong at individual ticks).
function stepLevelCheck(createOutDir, runOutDir, ticksRequested) {
  let initialState;
  let simConfig;
  let frames;
  try {
    initialState = JSON.parse(readFileSync(`${createOutDir}/initial-state.json`, "utf8"));
    simConfig = JSON.parse(readFileSync(`${createOutDir}/sim-config.json`, "utf8"));
    frames = JSON.parse(readFileSync(`${runOutDir}/tick-frames.json`, "utf8"));
  } catch (err) {
    return { checked: false, ticksChecked: 0, violations: [`could not load step-level inputs: ${err.message}`] };
  }
  if (!Array.isArray(frames)) {
    return { checked: false, ticksChecked: 0, violations: ["tick-frames.json is not an array"] };
  }

  const violations = [];

  const tiles = Array.isArray(simConfig?.layout?.data?.tiles) ? simConfig.layout.data.tiles.map(String) : null;
  const height = tiles ? tiles.length : 0;
  const width = tiles && height > 0 ? tiles[0].length : 0;

  // Tick continuity: exactly one "apply" phase-frame per requested tick, 1..N, no gaps or dupes —
  // catches a tick silently dropped or replayed twice, which no aggregate count would surface.
  const applyFrames = frames.filter((f) => f.phaseDetail === "apply").sort((a, b) => a.tick - b.tick);
  const applyTicks = applyFrames.map((f) => f.tick);
  const expectedTicks = Array.from({ length: ticksRequested }, (_, i) => i + 1);
  if (JSON.stringify(applyTicks) !== JSON.stringify(expectedTicks)) {
    violations.push(`tick continuity: expected apply phases [${expectedTicks.join(",")}], got [${applyTicks.join(",")}]`);
  }

  // Cumulative position replay, tick by tick — the same approach ak_show_state's own (correct)
  // resolveActorPositionsAtTick() uses, applied here as an assertion instead of a rendering.
  const positions = new Map();
  for (const actor of initialState?.actors || []) {
    if (actor?.id && Number.isFinite(actor?.position?.x) && Number.isFinite(actor?.position?.y)) {
      positions.set(actor.id, { x: actor.position.x, y: actor.position.y });
    }
  }

  for (const frame of applyFrames) {
    for (const action of frame.acceptedActions || []) {
      if (action.kind !== "move") continue;
      const to = action.params?.to;
      if (!to || !Number.isFinite(to.x) || !Number.isFinite(to.y)) {
        violations.push(`tick ${frame.tick}: accepted move for ${action.actorId} has a malformed destination`);
        continue;
      }
      if (tiles && (to.x < 0 || to.y < 0 || to.x >= width || to.y >= height)) {
        violations.push(`tick ${frame.tick}: accepted move put ${action.actorId} out of grid bounds at (${to.x},${to.y})`);
      } else if (tiles && tiles[to.y][to.x] === "#") {
        violations.push(`tick ${frame.tick}: accepted move put ${action.actorId} on a wall tile at (${to.x},${to.y})`);
      }
      positions.set(action.actorId, { x: to.x, y: to.y });
    }
    // Collision check, after this tick's moves are applied — two solid actors on one tile.
    const occupied = new Map();
    for (const [actorId, pos] of positions) {
      const key = `${pos.x},${pos.y}`;
      if (occupied.has(key)) {
        violations.push(`tick ${frame.tick}: ${actorId} and ${occupied.get(key)} both occupy (${key}) after accepted moves`);
      } else {
        occupied.set(key, actorId);
      }
    }
  }

  return { checked: true, ticksChecked: applyFrames.length, violations };
}

const DETERMINISM_FILES = [
  "tick-frames.json",
  "effects-log.json",
  "runtime-decision-captures.json",
  "run-summary.json",
  "action-log.json",
  "world-state.json",
];

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length || aKeys.some((k, i) => k !== bKeys[i])) return false;
  return aKeys.every((k) => deepEqual(a[k], b[k]));
}

// #149: action-log.json/run-summary.json/world-state.json stamp meta.id/meta.createdAt from the
// host's wall-clock createMeta()/makeId() (ak-impl.mjs:1597-1611) instead of the run's own seeded
// clock, so those two fields legitimately differ between two runs of identical input — confirmed
// as the ONLY thing that ever differs; every other field, including every field in tick-frames.json/
// effects-log.json/runtime-decision-captures.json (which use the seeded clock throughout), matched
// exactly. Stripped here, narrowly: only `id`+`createdAt` when they co-occur on an object shaped
// like a createMeta() stamp (so `runId`/`producedBy`/every other field still has to match — a real
// regression there is not masked). Once #149 is fixed this function becomes a no-op and can be
// deleted along with this whole exclusion.
function stripKnownNondeterministicMeta(value) {
  if (Array.isArray(value)) return value.map(stripKnownNondeterministicMeta);
  if (value && typeof value === "object") {
    const isMetaStamp = "id" in value && "createdAt" in value;
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (isMetaStamp && (k === "id" || k === "createdAt")) continue;
      out[k] = stripKnownNondeterministicMeta(v);
    }
    return out;
  }
  return value;
}

// Re-runs `ak run` a second time against the SAME create output (see the file-header comment for
// why this is the meaningful reproducibility boundary) and deep-compares every artifact it wrote
// the first time, after stripping the one known-nondeterministic field pair (see #149 above) — so
// this checks what it's meant to check, whether the SIMULATION is reproducible, without a known,
// separately-tracked harness gap drowning every result in noise.
function checkDeterminism(scenario, createOutDir, runOutDir, repeatOutDir) {
  const repeat = runStep(buildRunArgv(scenario, createOutDir, repeatOutDir));
  if (repeat.verdict !== "PASS") {
    return { checked: true, match: false, mismatches: [`repeat run did not pass: ${repeat.verdict} — ${repeat.detail}`] };
  }
  const mismatches = [];
  for (const file of DETERMINISM_FILES) {
    const originalPath = `${runOutDir}/${file}`;
    const repeatPath = `${repeatOutDir}/${file}`;
    const originalExists = existsSync(originalPath);
    const repeatExists = existsSync(repeatPath);
    if (originalExists !== repeatExists) {
      mismatches.push(`${file}: present in one run but not the other (original=${originalExists}, repeat=${repeatExists})`);
      continue;
    }
    if (!originalExists) continue;
    let original;
    let repeated;
    try {
      original = stripKnownNondeterministicMeta(JSON.parse(readFileSync(originalPath, "utf8")));
      repeated = stripKnownNondeterministicMeta(JSON.parse(readFileSync(repeatPath, "utf8")));
    } catch (err) {
      mismatches.push(`${file}: could not parse for comparison: ${err.message}`);
      continue;
    }
    if (!deepEqual(original, repeated)) {
      mismatches.push(`${file}: differs between the two runs (beyond the known #149 meta.id/createdAt gap)`);
    }
  }
  return { checked: true, match: mismatches.length === 0, mismatches };
}

rmSync(OUT_ROOT, { recursive: true, force: true });
mkdirSync(OUT_ROOT, { recursive: true });

const results = [];
for (const scenario of MATRIX) {
  const base = resolve(OUT_ROOT, "runs", scenario.id);
  const createOutDir = resolve(base, "create");
  const runOutDir = resolve(base, "run");
  const repeatOutDir = resolve(base, "run-repeat");

  const create = runStep(buildCreateArgv(scenario, createOutDir));

  let run = { verdict: DRY_RUN ? "SKIPPED_DRY_RUN" : "SKIPPED_CREATE_FAILED", detail: null };
  let runInfo = null;
  let stepLevel = { checked: false, ticksChecked: 0, violations: [] };
  let determinism = { checked: false, match: null, mismatches: [] };
  if (!DRY_RUN && create.verdict === "PASS") {
    run = runStep(buildRunArgv(scenario, createOutDir, runOutDir));
    if (run.verdict === "PASS") {
      runInfo = summarizeTickFrames(runOutDir);
      stepLevel = stepLevelCheck(createOutDir, runOutDir, TICKS);
      determinism = checkDeterminism(scenario, createOutDir, runOutDir, repeatOutDir);
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
    stepLevel,
    determinism,
  });

  const runInfoText = runInfo ? `actions=${runInfo.actionsAccepted} effects=${runInfo.effectsEmitted}` : "";
  const stepLevelText = stepLevel.checked
    ? (stepLevel.violations.length > 0 ? `step=VIOLATIONS(${stepLevel.violations.length})` : `step=OK(${stepLevel.ticksChecked})`)
    : "";
  const determinismText = determinism.checked
    ? (determinism.match ? "det=OK" : `det=MISMATCH(${determinism.mismatches.length})`)
    : "";
  process.stdout.write(
    `${scenario.id.padEnd(45)} create=${create.verdict.padEnd(24)} run=${run.verdict.padEnd(24)} ${runInfoText} ${stepLevelText} ${determinismText}\n`,
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
const stepLevelChecked = results.filter((r) => r.stepLevel.checked);
const stepLevelSummary = {
  checked: stepLevelChecked.length,
  clean: stepLevelChecked.filter((r) => r.stepLevel.violations.length === 0).length,
  withViolations: stepLevelChecked.filter((r) => r.stepLevel.violations.length > 0).length,
};
const determinismChecked = results.filter((r) => r.determinism.checked);
const determinismSummary = {
  checked: determinismChecked.length,
  reproducible: determinismChecked.filter((r) => r.determinism.match).length,
  mismatched: determinismChecked.filter((r) => !r.determinism.match).length,
};

const resultsPath = resolve(OUT_ROOT, `results-${DRY_RUN ? "dry-run" : "full"}.json`);
writeFileSync(resultsPath, JSON.stringify({ mode: DRY_RUN ? "dry-run" : "full", ticks: TICKS, seed: SEED, total: results.length, createSummary, runSummary, stepLevelSummary, determinismSummary, results }, null, 2));

console.log("\n--- create summary ---");
console.log(JSON.stringify(createSummary, null, 2));
if (!DRY_RUN) {
  console.log("\n--- run summary ---");
  console.log(JSON.stringify(runSummary, null, 2));
  console.log("\n--- step-level summary ---");
  console.log(JSON.stringify(stepLevelSummary, null, 2));
  console.log("\n--- determinism summary ---");
  console.log(JSON.stringify(determinismSummary, null, 2));
}
console.log(`\nfull results: ${resultsPath}`);

const anomalies = results.filter((r) => r.createVerdict.startsWith("ANOMALY") || r.runVerdict.startsWith("ANOMALY"));
const stepLevelFailures = results.filter((r) => r.stepLevel.violations.length > 0);
const determinismFailures = results.filter((r) => r.determinism.checked && !r.determinism.match);
if (anomalies.length > 0) {
  console.log(`\n--- ${anomalies.length} anomalies ---`);
  for (const a of anomalies) {
    console.log(`\n${a.id} (${a.description}):`);
    if (a.createDetail) console.log(`  create: ${a.createDetail}`);
    if (a.runDetail) console.log(`  run: ${a.runDetail}`);
  }
  process.exitCode = 1;
}
if (stepLevelFailures.length > 0) {
  console.log(`\n--- ${stepLevelFailures.length} scenarios with step-level violations ---`);
  for (const s of stepLevelFailures) {
    console.log(`\n${s.id} (${s.description}):`);
    for (const v of s.stepLevel.violations) console.log(`  ${v}`);
  }
  process.exitCode = 1;
}
if (determinismFailures.length > 0) {
  console.log(`\n--- ${determinismFailures.length} scenarios with non-reproducible output ---`);
  for (const s of determinismFailures) {
    console.log(`\n${s.id} (${s.description}):`);
    for (const m of s.determinism.mismatches) console.log(`  ${m}`);
  }
  process.exitCode = 1;
}
