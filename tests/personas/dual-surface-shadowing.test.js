/**
 * PX.5 — two independent paths reach one persona FSM, so a state label does not
 * imply the work that state claims.
 *
 * Three personas expose BOTH an `advance()` FSM surface and a service surface
 * (Configurator, Director, Allocator). The service methods do work and THEN advance
 * the FSM; `advance()` reaches the same FSM directly. Production uses the direct
 * path — `runner/runtime-fsm.mjs` injects the shadowing events on every tick:
 *
 *   configurator  provide_config (796) · validate (807) · lock (891)
 *   director      bootstrap · ingest_intent · draft_complete · refinement_complete (847-855)
 *   allocator     budget (820) · allocate (862)
 *
 * STATUS 2026-07-30 — RESOLVED for all three (Option A), by three different means,
 * because the three were not the same problem underneath:
 *   Configurator  the walk was pure ceremony — nothing read the states except the
 *                 code choosing the next event. The injections are simply gone.
 *   Allocator     `budget`/`allocate` shadow registerBudget/validateSpend and are
 *                 gone, but `monitor`/`rebalance` shadow nothing — they are the
 *                 Allocator's own signal-driven loop, and are KEPT. `monitor` may now
 *                 be entered from idle so that loop no longer has to pass through a
 *                 false budget claim to start.
 *   Director      the build-round walk is kept ONLY when there is no plan to consume.
 *                 A runtime started from a bare IntentEnvelope legitimately has the
 *                 Director draft one in-loop; a run whose SimConfig already names its
 *                 plan does not, and now gets a state-preserving `observe`.
 *
 * The first four tests still characterize what `advance()` PERMITS at the persona
 * level — that has not changed, and is the reason the runner must not use those
 * events. The last three assert the resolution.
 *
 * ⚠️ THE TRAP — READ BEFORE "FIXING" PX.5.
 * The obvious fix is to have `advance()` route its FSM events through the service
 * methods, so there is one path. For the Configurator that would produce VACUOUS
 * validation, not real validation, because THE TWO PLANES PASS DIFFERENT TYPES
 * under the same name `config`:
 *
 *   build plane   config = spec.configurator.inputs   {levelGen, resources, actors, …}
 *   tick plane    config = the SimConfigArtifact      {schema, meta, layout, seed, …}
 *
 * `validateConfiguratorConfig` is permissive-on-presence by design (production emits
 * partial shapes), so handed a SimConfig it finds none of the fields it checks and
 * passes. Routing advance() through validate() would therefore turn a green suite
 * into evidence of nothing — the exact façade pattern this program exists to remove.
 * The last test here pins that, so the trap fails loudly instead of being discovered
 * later.
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");
const P = "../../packages/runtime/src/personas";
const CLOCK = () => "2026-07-30T00:00:00.000Z";

test("PX.5 director: advance() reaches `ready` with no build round performed", async () => {
  const { createDirectorPersona } = await import(`${P}/director/persona.js`);
  const director = createDirectorPersona({ clock: CLOCK });
  const intentEnvelope = {
    schema: "agent-kernel/IntentEnvelope",
    schemaVersion: 1,
    meta: { id: "intent_px5", runId: "run_px5" },
    intent: { goal: "px5" },
  };

  director.advance({ phase: "decide", event: "bootstrap", payload: { intentEnvelope }, tick: 0 });
  director.advance({ phase: "decide", event: "ingest_intent", payload: { intentEnvelope }, tick: 0 });
  // draft_complete/refinement_complete are guarded on a planArtifact — but the guard
  // checks the PAYLOAD, not that the service ever ran, so any well-shaped object passes.
  const planArtifact = { schema: "agent-kernel/PlanArtifact", schemaVersion: 1, meta: { id: "plan_px5" } };
  director.advance({ phase: "decide", event: "draft_complete", payload: { planArtifact }, tick: 1 });
  director.advance({ phase: "decide", event: "refinement_complete", payload: { planArtifact }, tick: 1 });

  const view = director.view();
  assert.equal(view.state, "ready", "⚠️ PX.5: the FSM reports a COMPLETED build round…");
  assert.equal(view.context.buildSpecCount, 0, "…but no BuildSpec was ever assembled");
  assert.equal(view.context.planId, null, "…and the service never captured a plan");
});

test("PX.5 allocator: advance() reaches `allocating` with no budget registered", async () => {
  const { createAllocatorPersona } = await import(`${P}/allocator/persona.js`);
  const allocator = createAllocatorPersona({ clock: CLOCK });
  const budgets = [{ budget: { tokens: 100 } }];

  allocator.advance({ phase: "observe", event: "budget", payload: { budgets }, tick: 0 });
  allocator.advance({ phase: "decide", event: "allocate", payload: { budgets }, tick: 1 });

  const view = allocator.view();
  assert.equal(view.state, "allocating", "⚠️ PX.5: the FSM reports it is allocating…");
  assert.equal(view.context.budgetTokens, null, "…but registerBudget never ran");
  assert.equal(view.context.receiptCount, 0, "…and no spend was ever validated");
});

test("PX.5 the guards check payload SHAPE, not that the service did the work", async () => {
  // Why the guards do not save this: they are payload predicates. A well-shaped
  // object satisfies them regardless of whether any service method executed.
  const { createConfiguratorPersona } = await import(`${P}/configurator/persona.js`);
  const configurator = createConfiguratorPersona({ clock: CLOCK });

  // `validate` is guarded by hasConfig — satisfied by ANY object in the payload.
  configurator.advance({ phase: "init", event: "provide_config", payload: { config: { anything: true } }, tick: 0 });
  configurator.advance({ phase: "observe", event: "validate", payload: { config: { anything: true } }, tick: 1 });
  assert.equal(configurator.view().state, "configured");
  assert.equal(configurator.view().context.hasConfig, false, "the service holds no config at all");
});

test("PX.5 TRAP: the two planes pass different TYPES, so routing advance() through validate() would be vacuous", async () => {
  const { createConfiguratorPersona } = await import(`${P}/configurator/persona.js`);
  const simConfig = JSON.parse(
    readFileSync(resolve(ROOT, "tests/fixtures/goldens/create-g1/sim-config.json"), "utf8"),
  );

  // What the TICK plane hands the Configurator as `config` (runtime-fsm.mjs: config: simConfig).
  assert.deepEqual(
    Object.keys(simConfig).sort(),
    ["budgetReceiptRef", "layout", "meta", "planRef", "schema", "schemaVersion", "seed"],
    "a SimConfigArtifact has none of the fields validateConfiguratorConfig checks",
  );

  // Feeding it through the SERVICE surface — the "converged" path — is accepted,
  // because every field the validator knows about is absent and therefore optional.
  const configurator = createConfiguratorPersona({ clock: CLOCK });
  configurator.provideConfig(simConfig);
  assert.equal(
    configurator.validate().state,
    "configured",
    "⚠️ validate() ACCEPTS a SimConfig — it is not the shape this validator was written for. "
      + "Converging the surfaces without reconciling the two payload TYPES would make the tick "
      + "plane appear validated while checking nothing.",
  );

  // For contrast: the same validator does real work on the shape it was written for.
  const onInputs = createConfiguratorPersona({ clock: CLOCK });
  onInputs.provideConfig({ levelGen: { width: -1 }, resources: "not-an-array" });
  assert.throws(() => onInputs.validate(), (error) => error.code === "configurator_invalid");
});

test("PX.5 RESOLVED: the tick plane no longer sends any build-plane service event", () => {
  // These are the events a service method sends, so sending them from the runner
  // asserts work the runner did not do. Pinned as source assertions because the
  // point is their ABSENCE.
  const runner = readFileSync(resolve(ROOT, "packages/runtime/src/runner/runtime-fsm.mjs"), "utf8");
  const forbidden = {
    configurator: ["provide_config", "validate", "lock"],   // provideConfig/validate/lock
    allocator: ["budget", "allocate"],                       // registerBudget/validateSpend
  };
  for (const [persona, events] of Object.entries(forbidden)) {
    for (const event of events) {
      assert.ok(
        !new RegExp(`events\\.${persona} = "${event}"`).test(runner),
        `the tick plane must not inject ${persona} "${event}" — it is a service method's event`,
      );
    }
  }
  assert.equal(
    (runner.match(/personaStates\?\.configurator\?\.state/g) || []).length,
    0,
    "the runner must not read the Configurator's tick state to choose its next event",
  );
  // The capability is retained, not deleted: `events` is seeded from caller
  // overrides, so an explicit personaEvents entry still drives any persona.
  assert.match(runner, /const overrides = normalizePersonaEventsMap\(phaseInputs\.personaEvents\)/);
});

test("PX.5 RESOLVED: a run claims no build-plane work it did not do", async () => {
  const { createRuntime } = await import("../../packages/runtime/src/runner/runtime.js");
  const { createCore } = await import("../../packages/core-ts/src/index.ts");
  const load = (p) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));

  const runtime = createRuntime({ core: createCore(), adapters: {} });
  await runtime.init({
    seed: 0,
    // A SimConfig that already names its plan — the normal run. The plan was built
    // on the build plane; the tick plane consumes it.
    simConfig: load("tests/fixtures/artifacts/sim-config-artifact-v1-mvp-grid.json"),
    initialState: load("tests/fixtures/artifacts/initial-state-artifact-v1-mvp-actor.json"),
    runId: "run_px5_resolved",
    intentEnvelope: {
      schema: "agent-kernel/IntentEnvelope",
      schemaVersion: 1,
      meta: { id: "intent_px5", runId: "run_px5_resolved", createdAt: "2025-01-01T00:00:00.000Z", producedBy: "test" },
      source: "test",
      intent: { goal: "px5" },
    },
  });
  for (let i = 0; i < 4; i += 1) await runtime.step();

  const last = runtime.getTickFrames().filter((f) => f.phaseDetail === "summarize").pop();
  const views = last.personaViews;

  assert.equal(views.configurator.state, "uninitialized", "no config was assembled during the run");
  assert.equal(views.configurator.context.hasConfig, false);
  assert.equal(views.director.state, "uninitialized", "no build round ran during the run");
  assert.equal(views.director.context.buildSpecCount, 0);
  assert.ok(
    !["budgeting", "allocating"].includes(views.allocator.state),
    `the Allocator must not claim a budget round on the tick plane (got ${views.allocator.state})`,
  );
  // …while its OWN tick loop still runs, and the Orchestrator still progresses.
  assert.ok(["idle", "monitoring", "rebalancing"].includes(views.allocator.state));
  assert.equal(views.orchestrator.state, "running");
});

test("PX.5 the bare-intent capability survives: a run with NO SimConfig still plans in-loop", async () => {
  // Not everything the tick plane did was ceremony. A runtime started from an
  // IntentEnvelope alone has no plan to consume, and the Director drafting one
  // in-loop is the feature. The build-round walk is preserved for exactly that case,
  // which is why the fix is conditional rather than a removal.
  const { createRuntime } = await import("../../packages/runtime/src/runner/runtime.js");
  const core = {
    init() {}, applyAction() {}, getCounter() { return 0; },
    getEffectCount() { return 0; }, getEffectKind() { return 0; },
    getEffectValue() { return 0; }, clearEffects() {},
  };
  const runtime = createRuntime({ core, adapters: {} });
  await runtime.init({
    seed: 0,
    runId: "run_px5_bare",
    intentEnvelope: {
      schema: "agent-kernel/IntentEnvelope",
      schemaVersion: 1,
      meta: { id: "intent_bare", runId: "run_px5_bare", createdAt: "2025-01-01T00:00:00.000Z", producedBy: "test" },
      source: "test",
      intent: { goal: "plan from intent alone" },
    },
  });
  for (let i = 0; i < 3; i += 1) await runtime.step();

  const planFrames = runtime.getTickFrames().filter((frame) => Array.isArray(frame.personaArtifacts)
    && frame.personaArtifacts.some((artifact) => artifact?.schema === "agent-kernel/PlanArtifact"));
  assert.ok(planFrames.length > 0, "with no plan to consume, the Director still drafts one");
});

// ## TODO: Test Permutations
