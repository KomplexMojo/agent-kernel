/**
 * G1 annotator/per-tick-telemetry (A2 + A5) — P5.4, 2026-08-12.
 *
 * CR.8 gave the end-of-run RunSummary a provenance gate: a run that ticked cannot be
 * summarized by an Annotator still `idle`. The charter names the per-tick TelemetryRecords
 * in the same sentence, and they had no gate at all — `annotator-telemetry.test.js` exists
 * but drives the persona directly and never constructs a runtime, so it proves the
 * derivation and says nothing about who produces the records in production.
 *
 * That gap matters here more than most, because the façade is CHEAP: telemetry derivation is
 * pure, so a stand-in Annotator emits byte-identical records. Exactly how CR.8's violation
 * survived a green suite one level up.
 *
 *   1. **ABLATION (A2).** An Annotator that emits no telemetry ⇒ the tick frames carry none.
 *      The runner keeps no fallback that assembles records from the observations it already
 *      has — which it could trivially do, since it holds them.
 *   2. **PROVENANCE (A5).** Every record production emits is stamped `personaRef:
 *      "annotator"` and comes from the instance that moved out of `idle` during the run.
 *
 * ⚠️ **TEETH, and a false negative worth recording.** Perturbation: have the runner append a
 * TelemetryRecord of its own to the EMIT frame. The first attempt wrote
 * `emitRecord.telemetry || <runner record>` and was **NOT detected** — because with a silent
 * Annotator that field is `[]`, which is truthy, so the fallback never fired. The
 * perturbation was a no-op, not a weak assertion. Rewritten to append unconditionally, it
 * **fails the ablation**. ⇒ *An undetected perturbation is a claim to diagnose, not a result
 * to accept; "the guard did not catch it" and "there was nothing to catch" look identical in
 * a runner.*
 *
 * ⚠️ **WHAT THIS DOES NOT PROVE, stated rather than implied:** it does not force the record
 * to come from *the same* instance the way CR.8's refusal does for the summary. The tick loop
 * drives the Annotator itself, so the "fresh stand-in signs the artifact" scenario cannot
 * arise on this path — there is no glue-side call to intercept. If one is ever added
 * (an out-of-band `emitTelemetry` for a run someone else ticked), it needs CR.8's refusal,
 * not this test.
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "../../..");
const CLOCK = () => "2026-08-12T00:00:00.000Z";
const PERSONAS = "../../../packages/runtime/src/personas/";

function fixture(name) {
  return JSON.parse(readFileSync(resolve(ROOT, `tests/fixtures/artifacts/${name}`), "utf8"));
}

async function buildRegistry(annotator) {
  const { createAllocatorPersona } = await import(`${PERSONAS}allocator/persona.js`);
  const { createActorPersona } = await import(`${PERSONAS}actor/persona.js`);
  const { createModeratorPersona } = await import(`${PERSONAS}moderator/persona.js`);
  const allocator = createAllocatorPersona({ clock: CLOCK });
  return {
    allocator,
    actor: createActorPersona({ clock: CLOCK, admitProposals: allocator.admitProposals }),
    moderator: createModeratorPersona({ clock: CLOCK }),
    annotator,
  };
}

async function runTicks(annotator) {
  const { createRuntime } = await import("../../../packages/runtime/src/runner/runtime.js");
  const { createCore } = await import("../../../packages/core-ts/src/index.ts");

  const runtime = createRuntime({
    core: createCore(),
    adapters: {},
    personas: await buildRegistry(annotator),
  });
  await runtime.init({
    seed: 0,
    simConfig: fixture("sim-config-artifact-v1-mvp-grid.json"),
    initialState: fixture("initial-state-artifact-v1-mvp-actor.json"),
    runId: "run_g1_telemetry",
  });
  for (let i = 0; i < 3; i += 1) await runtime.step();
  return runtime.getTickFrames();
}

/**
 * The RECORDS, not the envelopes. A frame's `telemetry` is the Annotator's per-phase result
 * — `{ records: [...] }`, possibly several per frame — and the provenance lives on each
 * record's `meta.producedBy`. The first version of this test read `personaRef` off the
 * envelope, found `undefined`, and failed; the shape came from a probe against a real run
 * rather than from the docblock in the controller.
 */
function telemetryIn(frames) {
  return frames
    .flatMap((frame) => {
      const entry = frame?.telemetry;
      if (!entry) return [];
      return Array.isArray(entry) ? entry.filter(Boolean) : [entry];
    })
    .flatMap((entry) => (Array.isArray(entry.records) ? entry.records : [entry]));
}

/** An Annotator that transitions like the real one but records nothing. */
function silentAnnotator(real) {
  return {
    subscribePhases: real.subscribePhases,
    view: real.view,
    advance(input) {
      return { ...real.advance(input), telemetry: null };
    },
  };
}

test("G1 annotator/per-tick-telemetry: with the Annotator silent, production emits no records", async () => {
  const { createAnnotatorPersona } = await import(`${PERSONAS}annotator/persona.js`);

  // CONTROL — the real persona records the run.
  const withAnnotator = telemetryIn(await runTicks(createAnnotatorPersona({ clock: CLOCK })));
  assert.ok(
    withAnnotator.length > 0,
    "precondition: this run must actually produce TelemetryRecords, or the ablation is vacuous",
  );

  // ABLATION — the runner holds the same observations and must not assemble records itself.
  const withoutAnnotator = telemetryIn(
    await runTicks(silentAnnotator(createAnnotatorPersona({ clock: CLOCK }))),
  );
  assert.deepEqual(
    withoutAnnotator,
    [],
    "tick frames carried telemetry while the Annotator emitted none — the runner is producing "
      + "observability records itself, which is the second implementation A2 forbids",
  );
});

test("G1 annotator/per-tick-telemetry: every record is stamped by the instance that observed the run", async () => {
  const { createAnnotatorPersona } = await import(`${PERSONAS}annotator/persona.js`);

  const annotator = createAnnotatorPersona({ clock: CLOCK });
  const frames = await runTicks(annotator);
  const records = telemetryIn(frames);

  assert.ok(records.length > 0, "precondition: the run must have produced records");
  for (const record of records) {
    assert.equal(record.schema, "agent-kernel/TelemetryRecord");
    assert.equal(
      record.meta?.producedBy,
      "annotator",
      "a record reached a frame without the Annotator's stamp",
    );
    assert.equal(record.meta?.runId, "run_g1_telemetry", "the record must carry the run it observed");
  }

  // The instance that produced them is the one the run drove — it left `idle`, which is what
  // a freshly constructed stand-in still looks like (CR.8's tell, checked here per-tick).
  const states = frames.map((frame) => frame?.personaViews?.annotator?.state).filter(Boolean);
  assert.ok(
    states.some((state) => state !== "idle"),
    "the Annotator never left idle, so nothing in this run observed anything",
  );
  assert.notEqual(annotator.view().state, "idle");
});

// ## TODO: Test Permutations
// - a run with zero ticks: no records, and that is honest rather than a failure
// - an Annotator restored from view() mid-run: the records must continue, not restart
// - records vs the effect log: the same tick's effects must appear in both or neither
