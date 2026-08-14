/**
 * G1 — persona authority tests, driven by persona-authority-registry.js.
 *
 * Three jobs:
 *   1. Keep the registry HONEST — every persona covered, every open finding
 *      represented, every cited path real. A registry that has rotted is worse than
 *      none, because it reads like coverage.
 *   2. Publish the BACKLOG as a count instead of a judgement: one skipped test per
 *      unowned behavior, each naming the finding that blocks it (DECISION D-k).
 *   3. Run the live differentials for behaviors claimed as owned.
 *
 * The differential mechanism, for the one behavior that has it: production and the
 * persona standalone are given the same input, and their VERDICTS must agree. That
 * is the gate no output test can satisfy vacuously — a façade passes goldens by
 * construction, but it cannot agree with a persona it is not consulting.
 */
const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const {
  CHARTER_PERSONAS,
  REGISTRY,
  fixtureFor,
  isOwned,
  blockingFinding,
} = require("./persona-authority-registry.js");

const ROOT = resolve(__dirname, "../..");

// Findings still open in local-codex/Plan.md. Kept here so the registry cannot
// silently stop tracking one: if a finding is open but no entry names it, the
// coverage test below fails.
// Closed 2026-07-30: CR.3 (director/plan-artifact) and PX.5 (the tick plane no
// longer sends build-plane service events for any persona). CR.2 is absent because
// its tick-plane residue was PX.5, now closed; its build-plane half is owned.
// Closed 2026-07-31: CR.5 — tick ordering and effect fulfilment are Moderator
// policy now; CR.6 — the Actor holds no state outside its FSM and no longer owns
// budget admissibility. Both have live differentials below in place of their skips.
// Closed 2026-08-04, both landed at cf4dcdbd but never reflected here — the registry
// was reporting two proven behaviors as backlog, which is the same "reads like
// coverage" rot this file exists to prevent, pointed at itself:
//   PX.1 all/port-contract-single-origin — runtime imports core's EffectKind instead
//     of redeclaring a subset. Its G1 test is the LIVE EffectKind guard in
//     single-origin.test.js.
//   PX.4 all/restorable-from-view — every factory takes `{ from: view }`. Its G1 test
//     is G4 (persona-serialization-equivalence.test.js), 7/7.
// PX.3 CLOSED 2026-08-06 at M6. The note here used to read "requireClock covers the 14
// persona FACTORIES, but 18 non-factory sites still default a clock" — 11 of those 18 were
// persona files and are now injected; the remaining 7 are adapters/glue, where reading the
// wall clock is correct. The guard's scope moved from the 14 factories to the whole
// personas directory, which is what makes the claim checkable.
// CR.9 closed 2026-08-04 at M3: allocator/judges-not-authors is `owned`, proven by the
// ablation gate in tests/personas/allocator/allocator-judges-not-authors.test.js, and
// both Allocator->Configurator crossings are out of the allowlist. M4 (publishing the
// reject reason codes) and M5 (the package close + benchmark) are follow-on work on a
// finding that is no longer open, not residue of it.
const OPEN_FINDINGS = Object.freeze([
  // CR.1 closed at CR.9 M5, in the same diff as the un-skipped price/budget-split guard
  // that proves it (single-origin.test.js). Flipping an entry without a live test is the
  // exact rot e7501e9a had to correct.
  // PX.3 closed at M6 (2026-08-06), in the same diff as the guard that proves it: the
  // persona wall-clock scan now covers every persona file, not the 14 factories it was
  // first written for. Perturbation-verified against both spellings it used to miss.
  // PX.6 closed 2026-08-06: orchestrateBuild no longer mutates the artifact it records as
  // its causal input. Proven by a freeze differential plus a by-value comparison, both
  // perturbation-verified against the restored write-backs.
  // CR.4 closed 2026-08-10 at 2be417d6 (M1-M7) and this list said otherwise until
  // 2026-08-12 — TWO DAYS in which the backlog over-reported by one and the registry
  // described eight production call sites that a guard in this same directory asserted
  // did not exist. Nothing reported the contradiction, because a closure updates the
  // finding and nothing re-reads the instruments that named it. Same shape as the
  // orphaned allowlist dispositions: "the finding is closed" is not a query.
  //
  // CR.7 closed 2026-08-12 with the P5.1 flip: the persona boundary allowlist is empty and
  // the guard is a hard error. It was the last open finding of the program.
  //
  // P5.4 opened the same day, and it is what an empty finding list actually revealed: eight
  // chartered behaviors had NO registry entry, so the registry's own premise ("assumed not
  // owned until an entry says otherwise") made them invisible rather than tracked. Five went
  // straight in as OWNED — their proofs already existed, unclaimed, in the budget loop's
  // required-capability refusals — and three had no proof at all.
  //
  // Those three CLOSED 2026-08-13: the Actor ablation, the Moderator affinity
  // ablation+differential and the Annotator per-tick telemetry ablation now exist, each
  // perturbation-verified. So this list is empty again — and, as the backlog test below says
  // at length, that means every REGISTERED behavior is owned and nothing more.
  //
  // P5.5 opened 2026-08-13, when that list was worked through. Three of the five went in as
  // owned on proofs that already existed (spend authority through the real CLI, budget
  // maximization's price teeth, input preparation's state gate — the last claiming A3 ONLY,
  // because that is all its test proves). The other two are not unproven behaviors; they are
  // UNIMPLEMENTED ones, and that is the finding:
  //   orchestrator/deferred-side-effects — dispatchEffect defers, `ak inspect` counts, and
  //     nothing in the Orchestrator ever picks them up. The charter and two READMEs describe
  //     post-run coordination that does not exist.
  //   allocator/reconciliation — chartered, has its own README section, and `rg reconcil`
  //     over packages/runtime/src finds only the Configurator's layout tile reconciliation.
  // A G1 test cannot come before the behavior, so P5.5 is implementation work first.
  //
  // P5.5 CLOSED 2026-08-13: both behaviors were BUILT, and both are now owned with
  // perturbation-verified proofs. What had kept each of them unbuilt is the part worth
  // carrying, because in both cases it was a missing consumer rather than missing effort:
  //   allocator/reconciliation — `core.getBudgetUsage`, the ACTUAL half of "actual versus
  //     issued", had no runtime consumer anywhere. Caps went in and nothing read them back,
  //     so there was no second number to reconcile against. No instrument could report that:
  //     a counter nobody reads is indistinguishable from a counter that agrees.
  //   orchestrator/deferred-side-effects — the Moderator's DEFER decisions were recorded and
  //     then consumed by nothing but `ak inspect`'s counter. A run that dropped every
  //     deferral looked identical, in every output test, to a run that had none.
  // ⇒ Both are the same shape as the stale-instrument failures above, inverted: not an
  // instrument outliving its subject, but a subject with no instrument at all.
]);

// ---------------------------------------------------------------------------
// The registry stays honest
// ---------------------------------------------------------------------------

test("every charter persona has at least one registered behavior", () => {
  const covered = new Set(REGISTRY.map((entry) => entry.persona));
  for (const persona of CHARTER_PERSONAS) {
    assert.ok(covered.has(persona), `${persona} has no G1 registry entry — its behaviors are unmeasured`);
  }
});

test("every open finding is represented by at least one registry entry", () => {
  const blocking = new Set(REGISTRY.map(blockingFinding).filter(Boolean));
  const unrepresented = OPEN_FINDINGS.filter((finding) => !blocking.has(finding));
  assert.deepEqual(
    unrepresented,
    [],
    `open findings with no G1 entry (the backlog would under-report): ${unrepresented.join(", ")}`,
  );
});

test("registry entries are well-formed and cite paths that exist", () => {
  const ids = new Set();
  for (const entry of REGISTRY) {
    assert.ok(entry.id && !ids.has(entry.id), `duplicate or missing registry id: ${entry.id}`);
    ids.add(entry.id);

    assert.ok(CHARTER_PERSONAS.includes(entry.persona), `${entry.id}: unknown persona ${entry.persona}`);
    assert.ok(entry.behavior?.length > 0, `${entry.id}: needs a behavior description`);
    assert.ok(Array.isArray(entry.criteria) && entry.criteria.length > 0, `${entry.id}: needs A1-A5 criteria`);
    for (const criterion of entry.criteria) {
      assert.match(criterion, /^A[1-5]$/, `${entry.id}: "${criterion}" is not an A1-A5 criterion`);
    }
    assert.ok(["cli", "service", "none"].includes(entry.invocation), `${entry.id}: bad invocation kind`);

    // A cited production entry point that no longer exists means the registry has
    // rotted — the exact failure mode that made the boundary allowlist untrustworthy.
    assert.ok(
      existsSync(resolve(ROOT, entry.productionEntryPoint)),
      `${entry.id}: production entry point does not exist: ${entry.productionEntryPoint}`,
    );

    // Exactly one of owned / blockedBy.
    const owned = isOwned(entry);
    const blocked = Boolean(blockingFinding(entry));
    assert.ok(owned !== blocked, `${entry.id}: status must be either owned:true or blockedBy:<finding>`);
    if (blocked) {
      assert.ok(entry.status.why?.length > 0, `${entry.id}: a blocked entry must say why`);
    }
  }
});

/**
 * An OWNED entry must point at something that runs.
 *
 * Added CR.9 M5, and it is a gap this file had from the start: `registry entries are
 * well-formed` checked that a BLOCKED entry says why, and checked nothing at all about an
 * owned one. So "owned: true" was an assertion in prose — which is exactly the state
 * `e7501e9a` had to correct, where two entries sat flipped while their tests were skipping.
 * Prose cannot be run; a citation can be checked.
 *
 * Two acceptable proofs, because the registry legitimately has both shapes:
 *   - `status.provenBy`, a path that must exist (guards and G1 files outside this file), or
 *   - a `G1 <id>:` test declared in THIS file.
 * Nothing here can tell whether the cited test is meaningful — that is what the
 * perturbation discipline is for — but it can tell whether it exists, and that alone would
 * have caught the rot this project has already hit twice.
 */
test("every owned entry cites a proof that exists", () => {
  const selfSource = readFileSync(resolve(ROOT, "tests/architecture/persona-authority.test.js"), "utf8");

  for (const entry of REGISTRY.filter((candidate) => isOwned(candidate))) {
    const cited = entry.status.provenBy;
    const citedExists = Boolean(cited) && existsSync(resolve(ROOT, cited));
    const provenHere = selfSource.includes(`test("G1 ${entry.id}`);

    assert.ok(
      citedExists || provenHere,
      `${entry.id}: claims ownership with no runnable proof — add status.provenBy pointing `
        + `at the test that fails when the behavior regresses, or a "G1 ${entry.id}: ..." `
        + "test in this file. An owned entry with no test reads like coverage and is not.",
    );
    if (cited && !citedExists) {
      assert.fail(`${entry.id}: status.provenBy cites a file that does not exist: ${cited}`);
    }
  }
});

test("every cli-invocable entry has a standalone fixture", () => {
  for (const entry of REGISTRY.filter((candidate) => candidate.invocation === "cli")) {
    const fixture = fixtureFor(entry.persona);
    assert.ok(
      existsSync(resolve(ROOT, fixture)),
      `${entry.id}: no standalone fixture at ${fixture}`,
    );
  }
});

/**
 * The backlog, and what its emptiness does NOT mean.
 *
 * This used to assert `blocked.length >= 1` — "if nothing is blocked, either the program is
 * finished or the registry stopped tracking". As of 2026-08-12 the first branch is the true
 * one: CR.7 was the last open finding, and the P5.1 flip closed it. So the tripwire was
 * removed rather than left to fail on success.
 *
 * ⚠️ **AN EMPTY BACKLOG MEANS "EVERY REGISTERED BEHAVIOR IS OWNED", NOT "EVERY CHARTERED
 * BEHAVIOR IS OWNED".** The registry's own premise is that a behavior with no entry is
 * assumed NOT owned, and several have no entry — the Director's `mapPool`, `buildCardSet`,
 * `resolveTileCosts` and `assessFeasibility` are gated and tested but have no G1 asking the
 * A2 question, and each persona README says so under its status table. The next honest move
 * for this file is new ENTRIES, not a green count.
 */
test("the backlog is measured: report owned vs blocked", () => {
  const owned = REGISTRY.filter(isOwned);
  const blocked = REGISTRY.filter((entry) => blockingFinding(entry));
  assert.equal(owned.length + blocked.length, REGISTRY.length);
  assert.ok(owned.length >= 1, "at least one behavior must be provably owned");
  // Every entry must still resolve to exactly one of the two states — the shape check that
  // survives the backlog reaching zero.
  for (const entry of REGISTRY) {
    assert.ok(
      isOwned(entry) !== Boolean(blockingFinding(entry)),
      `${entry.id}: neither owned nor blocked`,
    );
  }
});

// ---------------------------------------------------------------------------
// The backlog, as one skipped test per unowned behavior (D-k)
// ---------------------------------------------------------------------------

for (const entry of REGISTRY.filter((candidate) => blockingFinding(candidate))) {
  test.skip(
    `G1 [${blockingFinding(entry)}] ${entry.persona}: ${entry.behavior} (${entry.criteria.join("+")})`,
    () => {
      // Intentionally unimplemented. Writing the differential is part of closing
      // ${blockingFinding(entry)}; this skip exists so the behavior is visible as
      // unowned rather than absent. See entry ${entry.id}.
    },
  );
}

// ---------------------------------------------------------------------------
// Live differential: configurator/validate-lock@build (owned since CR.2)
// ---------------------------------------------------------------------------

test("G1 configurator/validate-lock@build: production and the standalone persona agree on every verdict", async () => {
  const { runAuthoringBuild } = await import("../../packages/runtime/src/build/authoring-build.js");
  const { createConfiguratorPersona } = await import(
    "../../packages/runtime/src/personas/configurator/persona.js"
  );

  // Resources are the honest vehicle: mapResources carries authored fields through
  // without synthesizing missing ones, so a bad entry survives to validate().
  // (levelGen cannot be — prepareLevelGen regenerates it before validation sees it.)
  const cases = [
    { name: "valid resource", resources: [{ id: "resource_1", tier: "common", stat: "health", delta: 1, dropRate: 1 }] },
    { name: "id-less resource", resources: [{ tier: "common", stat: "health", delta: 1, dropRate: 1 }] },
    { name: "blank id", resources: [{ id: "   ", tier: "common", stat: "health", delta: 1, dropRate: 1 }] },
    { name: "no resources at all", resources: [] },
  ];

  for (const testCase of cases) {
    // The persona's own verdict, reached standalone through its service surface.
    const standalone = createConfiguratorPersona({ clock: () => "2026-07-29T00:00:00.000Z" });
    standalone.provideConfig({});
    if (testCase.resources.length > 0) standalone.mapResources(testCase.resources);
    let personaAccepts = true;
    try {
      standalone.validate();
    } catch (error) {
      assert.equal(error.code, "configurator_invalid", `${testCase.name}: unexpected refusal kind`);
      personaAccepts = false;
    }

    // Production's verdict on the same input.
    let productionAccepts = true;
    let productionError = null;
    try {
      await runAuthoringBuild({
        summary: { commandName: "create" },
        commandName: "create",
        runId: `run_g1_${testCase.name.replace(/\W+/g, "_")}`,
        createdAt: "2026-07-29T00:00:00.000Z",
        resources: testCase.resources,
      });
    } catch (error) {
      productionAccepts = false;
      productionError = error;
    }

    assert.equal(
      productionAccepts,
      personaAccepts,
      `${testCase.name}: production ${productionAccepts ? "accepted" : "refused"} a config the `
        + `Configurator ${personaAccepts ? "accepted" : "refused"} — glue reached a different verdict `
        + "than the owning persona, which is a second implementation of a chartered decision",
    );
    if (!personaAccepts) {
      assert.equal(
        productionError.code,
        "configurator_invalid",
        `${testCase.name}: production must fail with the PERSONA's error, not its own`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Live differential: director/plan-artifact (owned since CR.3)
// ---------------------------------------------------------------------------

test("G1 director/plan-artifact: the persisted plan is the one the Director drafted", async () => {
  const { runAuthoringBuild } = await import("../../packages/runtime/src/build/authoring-build.js");
  const { createDirectorPersona } = await import(
    "../../packages/runtime/src/personas/director/persona.js"
  );

  const runId = "run_g1_director";
  const createdAt = "2026-07-30T00:00:00.000Z";
  const summary = { commandName: "create", goal: "G1 director differential" };

  // Production's persisted lineage.
  const { buildResult } = await runAuthoringBuild({
    summary, commandName: "create", runId, createdAt,
  });

  // The same round, standalone. If production's plan is a post-hoc reconstruction
  // rather than this round's output, the two disagree.
  const director = createDirectorPersona({ clock: () => createdAt });
  const intentEnvelope = {
    schema: "agent-kernel/IntentEnvelope",
    schemaVersion: 1,
    meta: { id: `intent_${runId}`, runId, createdAt, producedBy: "cli" },
    source: "cli-create",
    intent: { goal: summary.goal },
  };
  const { planArtifact } = director.beginBuild(intentEnvelope, { runId });

  assert.equal(
    buildResult.plan.intentRef.id,
    planArtifact.intentRef.id,
    "the persisted plan must reference the intent that OPENED the round, not one rebuilt from the "
      + "finished spec — a mismatch means the lineage is reconstructed, i.e. provenance theater",
  );
  assert.equal(buildResult.plan.meta.correlationId, planArtifact.meta.correlationId);
  assert.equal(buildResult.plan.meta.producedBy, "director");
  assert.equal(
    buildResult.intent.meta.id,
    intentEnvelope.meta.id,
    "the persisted intent must be the real envelope, not a reconstruction from the spec",
  );
  assert.equal(
    buildResult.plan.intentRef.id,
    buildResult.intent.meta.id,
    "plan.intentRef and the persisted intent must agree",
  );

  // The id stays on the glue scheme so sim-config.json's planRef is byte-identical
  // (P2.1c, maintainer decision) — the ONE thing about the plan that reaches goldens.
  assert.equal(buildResult.plan.meta.id, `${runId}_plan`);
  assert.equal(buildResult.simConfig.planRef.id, `${runId}_plan`);
});

test("G1 configurator/validate-lock@build: neutering the persona's verdict breaks production (ablation)", async () => {
  // The backstop for A2. If validate() could not refuse, production would build
  // anything — which is precisely the state CR.2 found and fixed. Asserted here
  // against the real module so the dependency is structural, not documentary.
  const { runAuthoringBuild } = await import("../../packages/runtime/src/build/authoring-build.js");
  const source = require("node:fs").readFileSync(
    resolve(ROOT, "packages/runtime/src/build/authoring-build.js"),
    "utf8",
  );
  assert.match(
    source,
    /configurator\.validate\(\);\s*\n\s*configurator\.lock\(\);/,
    "runAuthoringBuild must call validate() then lock() — removing either is what CR.2 fixed",
  );

  // And the refusal genuinely stops the build rather than being logged.
  await assert.rejects(
    () => runAuthoringBuild({
      summary: { commandName: "create" },
      commandName: "create",
      runId: "run_g1_ablation",
      createdAt: "2026-07-29T00:00:00.000Z",
      resources: [{ tier: "common", stat: "health", delta: 1, dropRate: 1 }],
    }),
    (error) => error.code === "configurator_invalid",
  );
});

// ---------------------------------------------------------------------------
// Live differential: moderator/tick-ordering (owned since CR.5)
// ---------------------------------------------------------------------------

test("G1 moderator/tick-ordering: production executes the order the Moderator planned", async () => {
  const { createRuntime } = await import("../../packages/runtime/src/runner/runtime.js");
  const { createModeratorPersona } = await import(
    "../../packages/runtime/src/personas/moderator/persona.js"
  );

  const core = {
    init() {}, step() {}, applyAction() {},
    getCounter: () => 0,
    getEffectCount: () => 0,
    getEffectKind: () => 0,
    getEffectValue: () => 0,
    clearEffects() {},
  };
  const stub = (label) => ({
    subscribePhases: [],
    advance: () => ({ state: label, context: {} }),
    view: () => ({ state: label, context: {} }),
  });

  // Registries deliberately supplied in NON-canonical order, so agreement cannot
  // be an accident of insertion order.
  const cases = [
    { name: "full roster", names: ["annotator", "actor", "orchestrator", "allocator", "director", "configurator"] },
    { name: "sparse subset", names: ["annotator", "director"] },
    { name: "with unknowns", names: ["zeta", "actor", "alpha"] },
  ];

  for (const testCase of cases) {
    const personas = Object.fromEntries(testCase.names.map((n) => [n, stub(n)]));
    personas.moderator = createModeratorPersona({ clock: () => "2026-07-31T00:00:00.000Z" });

    // The persona's own verdict, reached standalone through its advance() surface.
    const standalone = createModeratorPersona({ clock: () => "2026-07-31T00:00:00.000Z" });
    const personaOrder = standalone.advance({
      phase: "init",
      event: "plan_persona_order",
      payload: { personaNames: Object.keys(personas) },
      tick: 0,
    }).personaOrder;

    // Production's order on the same registry.
    const runtime = createRuntime({ core, adapters: {}, personas });
    await runtime.init({ seed: 0 });
    await runtime.step({});
    const productionOrder = Object.keys(runtime.getTickFrames().at(-1).personaViews);

    assert.deepEqual(
      productionOrder,
      personaOrder,
      `${testCase.name}: production advanced personas in an order the Moderator did not plan — `
        + "that is a second implementation of a chartered decision",
    );
  }
});

test("G1 moderator/tick-ordering: production applies the fulfilment the Moderator decided", async () => {
  const { createRuntime } = await import("../../packages/runtime/src/runner/runtime.js");
  const { createModeratorPersona } = await import(
    "../../packages/runtime/src/personas/moderator/persona.js"
  );

  const effectList = [
    { id: "eff-z", kind: "log", severity: "info", data: { message: "z" } },
    { id: "eff-a", kind: "need_external_fact", requestId: "r", targetAdapter: "fx", sourceRef: { id: "s" }, data: {} },
    { id: "eff-m", kind: "need_external_fact", requestId: "r2", targetAdapter: "fx", data: {} },
    { id: "eff-b", kind: "telemetry", fulfillment: "deferred", data: {} },
  ];

  // The persona's own plan, reached standalone.
  const standalone = createModeratorPersona({ clock: () => "2026-07-31T00:00:00.000Z" });
  const plan = standalone.advance({
    phase: "emit",
    event: "plan_effect_fulfillment",
    payload: { effects: effectList },
    tick: 0,
  }).fulfillmentPlan;

  // Production's dispositions on the same effects.
  let count = effectList.length;
  const runtime = createRuntime({
    core: {
      init() {}, step() {}, applyAction() {},
      getCounter: () => 0,
      getEffectCount: () => count,
      getEffectKind: (i) => i,
      getEffectValue: (i) => i,
      clearEffects() { count = 0; },
    },
    adapters: { logger: { log: () => "ok", warn: () => "ok", error: () => "ok" } },
    effectFactory: ({ index }) => effectList[index],
  });
  await runtime.init({ seed: 0 });
  const fulfilled = runtime.getTickFrames()[0].fulfilledEffects;

  assert.deepEqual(
    fulfilled.map((entry) => entry.effect.id),
    plan.map((decision) => effectList[decision.index].id),
    "production emitted effects in an order the Moderator did not plan",
  );
  assert.deepEqual(
    fulfilled.map((entry) => entry.status),
    plan.map((decision) => decision.status ?? "fulfilled"),
    "production reached a disposition the Moderator did not decide",
  );
  assert.deepEqual(
    fulfilled.map((entry) => entry.reason ?? null),
    plan.map((decision) => decision.reason ?? null),
    "production recorded a deferral reason the Moderator did not give",
  );
});

// ---------------------------------------------------------------------------
// Live differentials: actor/no-budget-policy + actor/serializable-decision (CR.6)
// ---------------------------------------------------------------------------

test("G1 actor/no-budget-policy: production admits exactly what the Allocator admits", async () => {
  const { createRuntime } = await import("../../packages/runtime/src/runner/runtime.js");
  const { createCore } = await import("../../packages/core-ts/src/index.ts");
  const { createAllocatorPersona } = await import(
    "../../packages/runtime/src/personas/allocator/persona.js"
  );
  const { readFileSync } = require("node:fs");

  const simConfig = JSON.parse(readFileSync(resolve(ROOT, "tests/fixtures/artifacts/sim-config-artifact-v1-mvp-grid.json"), "utf8"));
  const initialState = JSON.parse(readFileSync(resolve(ROOT, "tests/fixtures/artifacts/initial-state-artifact-v1-mvp-actor.json"), "utf8"));

  // A receipt that denies movement outright. Without it the tick plane carries no
  // budget at all, so admission would be vacuous — this is what makes production
  // actually exercise the Allocator's judgement.
  const denyingReceipt = {
    schema: "agent-kernel/BudgetReceipt",
    schemaVersion: 1,
    lineItems: [{ kind: "motivation", id: "motivation_reflexive", status: "denied", quantity: 0 }],
  };
  const proposals = [
    { actorId: "actor_mvp", kind: "motivation", tier: "reflexive", params: { label: "reflexive" } },
    { actorId: "actor_mvp", kind: "custom_action", params: { label: "free" } },
  ];

  // The persona's own verdict, standalone.
  const standalone = createAllocatorPersona({ clock: () => "2026-07-31T00:00:00.000Z" });
  const admitted = standalone.admitProposals(proposals, { budgetReceipt: denyingReceipt });

  // Production's verdict on the same proposals + receipt, through the real runtime.
  const runtime = createRuntime({ core: createCore(), adapters: {} });
  await runtime.init({ seed: 0, simConfig, initialState, runId: "run_g1_cr6" });
  await runtime.step({
    personaPayloads: { actor: { proposals, budgetReceipt: denyingReceipt } },
  });

  const decideFrame = runtime.getTickFrames().filter((f) => f.phaseDetail === "decide").at(-1);
  const producedKinds = (decideFrame.personaActions || [])
    .filter((a) => proposals.some((p) => p.kind === a.kind))
    .map((a) => a.kind);

  assert.deepEqual(
    producedKinds,
    admitted.map((p) => p.kind),
    "production emitted a proposal set the Allocator did not admit — budget admissibility "
      + "has a second implementation",
  );
  assert.ok(
    !producedKinds.includes("motivation"),
    "precondition: the denying receipt must actually deny something, or this is vacuous",
  );
});

test("G1 actor/no-budget-policy: an Actor with no Allocator judge refuses a budget", async () => {
  const { createActorPersona } = await import("../../packages/runtime/src/personas/actor/persona.js");
  const { TickPhases } = await import("../../packages/runtime/src/personas/_shared/tick-state-machine.mts");

  const persona = createActorPersona({ clock: () => "fixed" });
  const observation = { tick: 0, actorId: "a", actors: [{ kind: 2, id: "a", position: { x: 1, y: 1 } }] };
  const payload = { actorId: "a", observation, baseTiles: ["#####", "#...E", "#####"] };
  persona.advance({ phase: TickPhases.OBSERVE, event: "observe", payload, tick: 0 });
  persona.advance({ phase: TickPhases.DECIDE, event: "decide", payload, tick: 0 });

  assert.throws(
    () => persona.advance({
      phase: TickPhases.DECIDE,
      event: "propose",
      payload: { ...payload, budgetReceipt: { lineItems: [] } },
      tick: 0,
    }),
    (error) => error.code === "actor_admissibility_required",
    "an Actor handed a budget with no judge must refuse, not silently admit everything",
  );
});

// TEETH: confirmed to FAIL when the pre-CR.6 fallbacks are restored inside
// resolveObservation/resolveBaseTiles. Note the guarantee is stronger than the
// closure removal alone — the proposal builders take only `payload` and
// `simConfig`, so patching a cached value into advance()'s locals does not reach
// derivation at all; a regression has to put the cache back in the resolvers.
test("G1 actor/serializable-decision: the Actor carries nothing outside view()", async () => {
  const { createActorPersona } = await import("../../packages/runtime/src/personas/actor/persona.js");
  const { TickPhases } = await import("../../packages/runtime/src/personas/_shared/tick-state-machine.mts");

  const observation = { tick: 0, actorId: "a", actors: [{ kind: 2, id: "a", position: { x: 1, y: 1 } }] };
  const payload = { actorId: "a", observation, baseTiles: ["#####", "#...E", "#####"] };

  // Withholding the decision inputs must now yield nothing rather than a decision
  // taken from remembered state. This is the A4 property CR.6 names: no channel
  // outside view() can influence the next action.
  const primed = createActorPersona({ clock: () => "fixed", seed: 3 });
  primed.advance({ phase: TickPhases.OBSERVE, event: "observe", payload, tick: 0 });
  primed.advance({ phase: TickPhases.DECIDE, event: "decide", payload, tick: 0 });
  const starved = primed.advance({
    phase: TickPhases.DECIDE,
    event: "propose",
    payload: { actorId: "a" },
    tick: 0,
  });
  assert.deepEqual(starved.actions, [], "a starved propose must not decide from remembered inputs");

  // And with the inputs supplied, it does decide — so the check above is not
  // passing merely because this fixture never proposes anything.
  const fed = createActorPersona({ clock: () => "fixed", seed: 3 });
  fed.advance({ phase: TickPhases.OBSERVE, event: "observe", payload, tick: 0 });
  fed.advance({ phase: TickPhases.DECIDE, event: "decide", payload, tick: 0 });
  const decided = fed.advance({ phase: TickPhases.DECIDE, event: "propose", payload, tick: 0 });
  assert.ok(decided.actions.length > 0, "precondition: the same fixture must propose when fed");
});

// ---------------------------------------------------------------------------
// Live differential: annotator/run-summary-provenance (owned since CR.8)
//
// A5 is a PROVENANCE criterion, so an output differential cannot settle it:
// summarizeRun is a pure derivation, and a throwaway Annotator produces a
// byte-identical summary. That is precisely how this violation survived a green
// suite. The gate therefore asserts WHICH INSTANCE produced it.
// ---------------------------------------------------------------------------

// TEETH NOTE (verified by perturbation, 2026-08-01): this first test does NOT detect
// the façade — restoring `createAnnotatorPersona({ clock: UNUSED_CLOCK })` inside
// summarizeRun leaves it green, because the derivation is pure and the output is
// byte-identical. It is a property + precondition assertion. **The refusal test below
// is the detector**, and it was confirmed to fail against that exact façade.
test("G1 annotator/run-summary-provenance: the summary comes from the instance that observed the run", async () => {
  const { createRuntime } = await import("../../packages/runtime/src/runner/runtime.js");
  const { createCore } = await import("../../packages/core-ts/src/index.ts");
  const { readFileSync } = require("node:fs");

  const simConfig = JSON.parse(readFileSync(resolve(ROOT, "tests/fixtures/artifacts/sim-config-artifact-v1-mvp-grid.json"), "utf8"));
  const initialState = JSON.parse(readFileSync(resolve(ROOT, "tests/fixtures/artifacts/initial-state-artifact-v1-mvp-actor.json"), "utf8"));

  const runtime = createRuntime({ core: createCore(), adapters: {} });
  await runtime.init({ seed: 0, simConfig, initialState, runId: "run_g1_cr8" });
  for (let i = 0; i < 3; i += 1) await runtime.step();

  const frames = runtime.getTickFrames();
  const annotatorStates = frames
    .map((frame) => frame.personaViews?.annotator?.state)
    .filter(Boolean);

  // Precondition: the run must actually have driven the Annotator, or the assertion
  // below proves nothing.
  assert.ok(
    annotatorStates.some((state) => state !== "idle"),
    "precondition: the run must move the Annotator out of idle",
  );

  const summary = runtime.summarizeRun({
    tickFrames: frames,
    effectLog: runtime.getEffectLog(),
    ticksRequested: 3,
    meta: { id: "run_summary_g1", runId: "run_g1_cr8", createdAt: "2026-08-01T00:00:00.000Z", producedBy: "annotator" },
  });

  assert.equal(summary.schema, "agent-kernel/RunSummary");
  assert.equal(summary.meta.producedBy, "annotator");
  // P3.2's derivation must survive CR.8 untouched — the defect was provenance, not
  // the outcome logic.
  assert.ok(typeof summary.outcome === "string" && summary.outcome.length > 0);
  assert.notEqual(summary.outcome, "unknown");
});

test("G1 annotator/run-summary-provenance: an Annotator that never observed is refused", async () => {
  const { createRuntime } = await import("../../packages/runtime/src/runner/runtime.js");
  const { createCore } = await import("../../packages/core-ts/src/index.ts");

  // The façade this finding is about: an Annotator that recorded nothing but is
  // asked to sign the artifact. Before CR.8 kernel.js constructed exactly this —
  // `createAnnotatorPersona({ clock: UNUSED_CLOCK })` — and it produced a
  // byte-identical summary, which is why no output test ever caught it.
  const stubAnnotator = {
    subscribePhases: [],
    advance: () => ({ state: "idle", context: {} }),
    view: () => ({ state: "idle", context: {} }),
    summarizeRun: () => ({ schema: "agent-kernel/RunSummary", schemaVersion: 1, outcome: "fabricated" }),
  };

  const runtime = createRuntime({
    core: createCore(),
    adapters: {},
    personas: { annotator: stubAnnotator },
  });
  await runtime.init({ seed: 0 });
  await runtime.step();

  assert.throws(
    () => runtime.summarizeRun({ tickFrames: runtime.getTickFrames(), effectLog: [], ticksRequested: 1 }),
    (error) => error.code === "annotator_did_not_observe",
    "a run that ticked must not be summarized by an Annotator still in idle",
  );
});

// ## TODO: Test Permutations
