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
 * These tests PIN THE CURRENT DEFECTIVE BEHAVIOR. They are not aspirational: each
 * asserts what happens today, so the diff that fixes PX.5 must update them and
 * cannot land silently. The Configurator's own pair lives beside its service tests
 * in configurator/configurator-validate-lock.test.js; this file covers the systemic
 * shape and the trap below.
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

test("PX.5 the tick-plane state walk gates nothing outside the runner's own next-event choice", () => {
  // The only consumers of the tick-plane Configurator state are the two lines that
  // decide which event to send NEXT. Nothing else in the codebase reads it, so the
  // walk uninitialized -> pending_config -> configured -> locked is ceremony. Pinned
  // as source assertions because the point is the ABSENCE of consumers.
  const runner = readFileSync(resolve(ROOT, "packages/runtime/src/runner/runtime-fsm.mjs"), "utf8");
  const reads = runner.match(/personaStates\?\.configurator\?\.state/g) || [];
  assert.equal(reads.length, 2, "if this changed, re-check whether the tick-plane state now gates something");
  assert.match(runner, /if \(cfgState === "pending_config"\) events\.configurator = "validate"/);
  assert.match(runner, /if \(cfgState === "configured"\) events\.configurator = "lock"/);
});

// ## TODO: Test Permutations
