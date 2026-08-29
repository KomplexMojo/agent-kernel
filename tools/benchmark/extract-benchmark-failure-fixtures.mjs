#!/usr/bin/env node
// Harvests non-success attempts from a reference content-gen benchmark run's raw `runs.jsonl`
// into a deterministic, deduplicated regression corpus under tests/fixtures/benchmark-failures/.
//
// See coding-issues-affecting-benchmarking.md -> M0 for why: the raw log is a 14-hour,
// non-deterministic signal; this turns it into a sub-second one. The raw `runs.jsonl` lives only
// on the benchmark box (plan §"Where the evidence lives") and is never committed -- this script,
// its input path, and its output are the audit trail for how the committed fixtures were derived.
//
// Usage:
//   node tools/benchmark/extract-benchmark-failure-fixtures.mjs --input <path-to-runs.jsonl>
//
// Regenerating: re-running against the SAME input reproduces byte-identical fixtures (the sort is
// a pure function of file order and content). The DISPOSITIONS table below is the one part of this
// script that is NOT mechanical -- it is the harness-defect/model-error judgement call for each
// deduplicated shape, made once here instead of by hand over all 173 raw rows. A new shape (from a
// different reference run) is refused rather than silently defaulted, so it always gets triaged.

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_DIR = join(REPO_ROOT, "tests", "fixtures", "benchmark-failures");

const SOURCE_RUN_ID = "2026-08-28T17-48-28-063Z-94b75c0d2094-60bd8e52";
const SCENARIO_SET_HASH = "d839c42a9932ce0c82d43d58c6cceca4b2191ba965d3f01773ce7d2feca3a001";
const MATRIX_HASH = "3def36d7d6cd0fca73a357bf1080887c3e191505814167fc60fbe211b05efc4e";

function parseArgs(argv) {
  const args = { input: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input") args.input = argv[++i];
  }
  if (!args.input) {
    throw new Error("usage: extract-benchmark-failure-fixtures.mjs --input <path-to-runs.jsonl>");
  }
  return args;
}

// Collapses embedded JSON blobs and numbers so records that differ only in the model's chosen
// values (an affinity, a vital max, a denied-pool remainder) group under the same failure shape.
function normalizeErrorShape(text) {
  if (!text) return "";
  let t = text;
  t = t.replace(/"\[\{.*?\}\]?"/g, '"<JSON>"');
  t = t.replace(/"\[\{.*/g, '"<JSON>"');
  t = t.replace(/-?\d+(\.\d+)?/g, "#");
  t = t.replace(/\s+/g, " ").trim();
  return t.slice(0, 160);
}

function groupKey(record) {
  const text = record.execStderr || record.llmError || "";
  return JSON.stringify([record.executionOutcome, record.expectedOutcome, normalizeErrorShape(text)]);
}

// Disposition for each deduplicated shape, in the rank order produced below (count desc, then
// first-seen order). "harness-defect" means the toolArgs is a reasonable request the harness
// should have accepted -- the replay test asserts success and starts RED. "model-error" means the
// toolArgs itself is the problem (malformed, infeasible, or a request the harness is correct to
// deny) -- the replay test asserts the denial reproduces and starts GREEN as a regression guard.
//
// M3 investigated all four symptom families the plan named as "unambiguously a harness bug".
// Only one survived: the JSON-array-as-segment shape (normalizeToolArgs' bracket repair was the
// actual gap). The other three turned out, on inspection of the real schema/CLI/parser code, to
// already be correctly rejected -- reclassified to model-error with the investigation recorded in
// each note. Buckets M2 and M4 are still investigating (conflicting_requirements, floor-tile
// budget, spatial placement) default to model-error with a "pending" note -- promoting one to
// harness-defect is that milestone's job, and it is a one-line diff against this table when it
// happens.
const DISPOSITIONS = [
  { disposition: "model-error", note: "expected budget_denied, correctly denied (delver pool)." },
  { disposition: "model-error", note: "pending M4: floor-tile capacity vs model over-asking, not yet determined." },
  { disposition: "harness-defect", note: "M3: model emits a JSON array where the CLI expects key=value segments." },
  { disposition: "model-error", note: "pending M2: may be a viability-floor regression, not yet determined." },
  { disposition: "model-error", note: "unexpected but correct: allocator enforcing the delver pool cap." },
  { disposition: "model-error", note: "incomplete V3 resource spec (delta without regen); not in M3's symptom table." },
  { disposition: "model-error", note: "pending M4: spatial placement vs model over-asking, not yet determined." },
  { disposition: "model-error", note: "expected budget_denied, correctly denied (warden pool)." },
  { disposition: "model-error", note: "pending M2: scenario expected a denial and got one, via a different path (conflicting_requirements instead of budget_denied)." },
  { disposition: "model-error", note: "unexpected but correct: allocator enforcing the warden pool cap." },
  { disposition: "model-error", note: "unexpected but correct: allocator enforcing the resource pool cap." },
  { disposition: "model-error", note: "genuinely infeasible: the CLI's own pre-allocator minimum-spend check, not the allocator." },
  { disposition: "not-replayable", note: "model produced no tool call at all -- toolArgs is null, nothing to replay through normalizeToolArgs->buildArgv->create. Pure model behaviour, no harness code path." },
  { disposition: "model-error", note: "incomplete V3 resource spec (permanenceMode required because vital is set); not in M3's symptom table." },
  { disposition: "model-error", note: "model authored nothing -- no --room/--floor-tile/--hazard/--resource/--delver/--warden." },
  { disposition: "model-error", note: "unexpected but correct: allocator enforcing the hazard pool cap." },
  { disposition: "model-error", note: "incomplete V3 resource spec (permanenceMode required because vital is set, variant wording); not in M3's symptom table." },
  { disposition: "model-error", note: "M3's normalizeToolArgs fix resolved the JSON-array-as-segment defect here too (the warden now parses). What surfaces next is spatial placement -- \"insufficient unoccupied walkable tiles\", the same cause as bf-007/bf-029 -- pending M4, not M3." },
  { disposition: "model-error", note: "incomplete V3 resource spec (permanenceMode required because regen is set); not in M3's symptom table." },
  { disposition: "model-error", note: "M3 investigated: dungeonAffinity already carries the AFFINITY_ENUM (since the schema's first commit, 2026-05-05) -- the model sent \"neutral\", which is not a real affinity and never was. Schema and CLI already agree; no drift to fix." },
  { disposition: "model-error", note: "unexpected but correct: allocator enforcing the resource-affinity pool cap." },
  { disposition: "model-error", note: "scenario expected a denial; the CLI's pre-allocator minimum-spend check fired instead." },
  { disposition: "model-error", note: "M3 investigated: the model sent vital:{health:{max:20}} -- the actor entities' vitals shape, not resource's own bare-string vital. Auto-repairing would mean guessing whether max was meant as delta; too semantically ambiguous to accept silently. Schema's vital field gained a description clarifying the bare-string contract as a preventive (not retroactive) measure." },
  { disposition: "model-error", note: "hazard field \"manaRegen\" is not part of the hazard schema -- model invented it." },
  { disposition: "model-error", note: "M3 investigated: mana:-5 is genuinely invalid -- a hazard's mana pool size cannot be negative; this parser has no drain concept for it to express. No fix: correctly rejected." },
  { disposition: "model-error", note: "M3 investigated: mana:\"one-time:15:0:0\" blends the one-time and regen grammars (one-time takes exactly one number). A candidate fix (add a one-time:<amount> example -- currently absent, though the model half-guessed the keyword) was considered but not landed: hazard.mana already carries a scar from an unmeasured description edit that tripled malformed values, and this is one occurrence. Left as model-error pending an A/B-measured change." },
  { disposition: "harness-defect", note: "M3: same JSON-array-as-segment defect as shape 3/18, surfaced on a denial-expecting scenario." },
  { disposition: "model-error", note: "resource affinity payload missing required mana field." },
  { disposition: "model-error", note: "pending M4: spatial placement (resource) vs model over-asking, not yet determined." },
  { disposition: "model-error", note: "warden affinity kind \"pull\" is a hazard-expression verb, not a valid affinity kind -- model confused the two vocabularies." },
  { disposition: "not-replayable", note: "M5's target: toolArgs is null -- Ollama's tool-call parser failed before any args existed. Out of scope for the normalizeToolArgs->buildArgv->create path." },
  { disposition: "model-error", note: "unexpected but correct: allocator enforcing the hazard pool cap (variant deniedLines)." },
  { disposition: "model-error", note: "scenario expected a denial; the CLI's pre-allocator minimum-spend check fired instead (variant)." },
  { disposition: "model-error", note: "room field \"description\" is not part of the room schema -- model invented it." },
  { disposition: "model-error", note: "delver affinity value outside the supported enum." },
  { disposition: "model-error", note: "unexpected but correct: allocator enforcing the resource-affinity pool cap (variant deniedLines)." },
  { disposition: "model-error", note: "unexpected but correct: allocator enforcing combined tile/resource pool caps." },
  { disposition: "model-error", note: "expected budget_denied, correctly denied (floor tiles)." },
  { disposition: "model-error", note: "resource field \"count\" is legacy pre-V3 vocabulary; V3 spec rejects it." },
  { disposition: "model-error", note: "incomplete V3 resource spec (permanenceMode required because both permanenceMode-triggers are set); not in M3's symptom table." },
  { disposition: "model-error", note: "scenario expected a denial; the CLI's pre-allocator minimum-spend check fired instead (variant)." },
  { disposition: "model-error", note: "unexpected but correct: allocator enforcing combined resource/actor pool caps." },
  { disposition: "model-error", note: "unexpected but correct: allocator enforcing the floor-tile pool cap alone." },
];

function main() {
  const args = parseArgs(process.argv.slice(2));
  const raw = readFileSync(args.input, "utf8").trim().split("\n").map((line) => JSON.parse(line));

  const nonSuccess = raw.filter((r) => r.execSucceeded === false);

  const groups = new Map();
  for (const record of nonSuccess) {
    const key = groupKey(record);
    if (!groups.has(key)) groups.set(key, { records: [] });
    groups.get(key).records.push(record);
  }

  const ranked = [...groups.values()].sort((a, b) => b.records.length - a.records.length);

  if (ranked.length !== DISPOSITIONS.length) {
    throw new Error(
      `${ranked.length} deduplicated shapes but ${DISPOSITIONS.length} dispositions are on file. ` +
      `A new or removed shape needs triage before this can run -- see the DISPOSITIONS comment.`,
    );
  }

  // Only remove what this script itself owns (bf-*.json, index.json) -- a blanket directory wipe
  // silently deleted the hand-written README.md on every regeneration, which is exactly the kind
  // of dropped content rule 4 in the plan's "not negotiable" list exists to catch.
  mkdirSync(OUT_DIR, { recursive: true });
  if (existsSync(OUT_DIR)) {
    for (const name of readdirSync(OUT_DIR)) {
      if (/^bf-\d+\.json$/.test(name) || name === "index.json") {
        rmSync(join(OUT_DIR, name), { force: true });
      }
    }
  }

  const index = [];
  let harnessDefectCount = 0;
  let modelErrorCount = 0;
  let notReplayableCount = 0;

  ranked.forEach((group, i) => {
    const representative = group.records[0];
    const { disposition, note } = DISPOSITIONS[i];
    const id = `bf-${String(i + 1).padStart(3, "0")}`;

    const fixture = {
      id,
      sourceRunId: SOURCE_RUN_ID,
      scenarioSetHash: SCENARIO_SET_HASH,
      scenarioIndex: representative.scenarioIndex,
      scenarioTitle: representative.scenarioTitle,
      expectedOutcome: representative.expectedOutcome,
      observedOutcome: representative.executionOutcome,
      scenarioBudget: representative.scenarioBudget,
      toolArgs: representative.toolArgs,
      observedError: representative.execStderr || representative.llmError || null,
      occurrences: group.records.length,
      disposition,
      dispositionNote: note,
    };

    writeFileSync(join(OUT_DIR, `${id}.json`), `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
    index.push({ id, scenarioIndex: fixture.scenarioIndex, expectedOutcome: fixture.expectedOutcome, observedOutcome: fixture.observedOutcome, occurrences: fixture.occurrences, disposition });

    if (disposition === "harness-defect") harnessDefectCount++;
    else if (disposition === "model-error") modelErrorCount++;
    else notReplayableCount++;
  });

  const totalOccurrences = ranked.reduce((sum, g) => sum + g.records.length, 0);

  console.log(`Extracted ${ranked.length} deduplicated fixtures from ${nonSuccess.length} non-success attempts.`);
  console.log(`  harness-defect: ${harnessDefectCount}`);
  console.log(`  model-error:    ${modelErrorCount}`);
  console.log(`  not-replayable: ${notReplayableCount}`);
  console.log(`Occurrence total (sanity check, should equal ${nonSuccess.length}): ${totalOccurrences}`);

  writeFileSync(
    join(OUT_DIR, "index.json"),
    `${JSON.stringify({ sourceRunId: SOURCE_RUN_ID, scenarioSetHash: SCENARIO_SET_HASH, matrixHash: MATRIX_HASH, totalNonSuccessAttempts: nonSuccess.length, fixtures: index }, null, 2)}\n`,
    "utf8",
  );
}

main();
