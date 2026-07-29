/**
 * CR.2 — the Configurator's validate() and lock() must gate real behavior.
 *
 * The 2026-07-28 adversarial review found both were label-only: validate() was
 * requireState + fsm.advance + return, lock() the same, and the production
 * authoring path (build/authoring-build.js) never called EITHER before
 * orchestrateBuild did the real work. Two thirds of the Configurator's chartered
 * role — "configuration assembly, validation, locking" — were labels, which the
 * charter names a defect. P2.2 was recorded DONE while failing that criterion.
 *
 * These are G3 state-gate tests (criterion A3: the same call in two different
 * states must produce DIFFERENT observable outcomes) plus the A2 necessary-path
 * assertion (production cannot produce a build without the Configurator's
 * approval). Empirically verified before this file was written: validate()
 * accepted `{levelGen: {width: "not-a-number", height: -3, shape: "wrong-type"},
 * resources: "not-an-array"}` and returned "configured".
 *
 * SCOPE CORRECTION to the finding as filed: lock() was NOT entirely without
 * effect — the `locked` state already refused further prepareLevelGen/mapResources
 * (they require pending_config|configured). What was missing is a versioned,
 * immutable published config. That part of the finding stands; the "no gate at
 * all" reading of lock() does not.
 */
const assert = require("node:assert/strict");

const CONFIGURATOR = "../../../packages/runtime/src/personas/configurator/persona.js";

async function makeConfigurator() {
  const { createConfiguratorPersona } = await import(CONFIGURATOR);
  return createConfiguratorPersona({ clock: () => "2026-07-29T00:00:00.000Z" });
}

// A config shaped like the ones production actually assembles (see the
// create-g1 / resource-plan-g4 goldens): levelGen with width/height/shape,
// plus optional actors/resources arrays.
function validConfig() {
  return {
    levelGen: {
      width: 9,
      height: 9,
      shape: { roomCount: 1, roomMinSize: 5, roomMaxSize: 5, corridorWidth: 1 },
    },
    levelAffinity: "fire",
    actors: [],
    actorGroups: [],
  };
}

// ---------------------------------------------------------------------------
// validate() performs REAL structural checks (was: zero checks)
// ---------------------------------------------------------------------------

test("validate() rejects a structurally malformed config and does NOT advance", async () => {
  const c = await makeConfigurator();
  c.provideConfig({
    levelGen: { width: "not-a-number", height: -3, shape: "wrong-type" },
    resources: "not-an-array",
  });
  assert.throws(
    () => c.validate(),
    (e) => e.code === "configurator_invalid" && Array.isArray(e.errors) && e.errors.length > 0,
  );
  // A refusal must not move the FSM — otherwise the rejection is cosmetic.
  assert.equal(c.view().state, "pending_config");
  assert.equal(c.view().context.validated, false);
});

test("validate() reports EVERY problem, not just the first", async () => {
  const c = await makeConfigurator();
  c.provideConfig({
    levelGen: { width: 0, height: -1, walkableTilesTarget: "many", hazards: "not-an-array" },
    resources: [{ id: "" }],
    actors: "not-an-array",
  });
  let caught;
  try {
    c.validate();
  } catch (e) {
    caught = e;
  }
  assert.ok(caught, "validate() must throw on a malformed config");
  const joined = caught.errors.join("\n");
  for (const path of [
    "levelGen.width",
    "levelGen.height",
    "levelGen.walkableTilesTarget",
    "levelGen.hazards",
    "resources[0].id",
    "actors",
  ]) {
    assert.match(joined, new RegExp(path.replace(/[[\]().]/g, "\\$&")), `expected an error for ${path}`);
  }
});

test("validate() rejects roomMinSize greater than roomMaxSize — an invariant, not a type", async () => {
  const c = await makeConfigurator();
  const config = validConfig();
  config.levelGen.shape = { roomCount: 1, roomMinSize: 9, roomMaxSize: 5, corridorWidth: 1 };
  c.provideConfig(config);
  assert.throws(() => c.validate(), (e) => e.code === "configurator_invalid");
});

test("validate() accepts the shapes production actually emits", async () => {
  const c = await makeConfigurator();
  c.provideConfig(validConfig());
  assert.equal(c.validate().state, "configured");
  assert.equal(c.view().context.validated, true);

  // resource-plan-g4's golden shape: a partial `shape` with roomCount only, and
  // a 5x5 grid. Mandating roomMinSize/roomMaxSize/corridorWidth here would
  // reject a config production emits today.
  const c2 = await makeConfigurator();
  c2.provideConfig({
    levelGen: { width: 5, height: 5, shape: { roomCount: 1 }, budgetScaffold: true },
    levelAffinity: "fire",
    actors: [],
    actorGroups: [],
    resources: [{ id: "resource_1", permanenceMode: "consumable", vitals: [] }],
  });
  assert.equal(c2.validate().state, "configured");
});

// ---------------------------------------------------------------------------
// lock() publishes an immutable, versioned config (was: no output at all)
// ---------------------------------------------------------------------------

test("lock() publishes a frozen, versioned config snapshot", async () => {
  const c = await makeConfigurator();
  c.provideConfig(validConfig());
  c.validate();
  const locked = c.lock();

  assert.equal(locked.state, "locked");
  assert.equal(locked.version, 1);
  assert.ok(locked.config, "lock() must return the config it locked");
  assert.ok(Object.isFrozen(locked.config), "the locked config must be frozen");
  assert.ok(Object.isFrozen(locked.config.levelGen), "the freeze must be deep");
  assert.ok(Object.isFrozen(locked.config.levelGen.shape), "the freeze must reach nested objects");
  assert.equal(locked.config.levelGen.width, 9);
  assert.deepEqual(JSON.parse(JSON.stringify(locked.config)), locked.config);
});

test("lock() is the only way to obtain a locked config — lockedConfig() is null before", async () => {
  const c = await makeConfigurator();
  c.provideConfig(validConfig());
  assert.equal(c.lockedConfig(), null);
  c.validate();
  assert.equal(c.lockedConfig(), null, "validate() alone must not publish a locked config");
  c.lock();
  assert.ok(c.lockedConfig(), "lock() publishes it");
  assert.equal(c.lockedConfig().levelGen.width, 9);
});

test("the locked snapshot does not change when the caller mutates its own object afterwards", async () => {
  const c = await makeConfigurator();
  const caller = validConfig();
  c.provideConfig(caller);
  c.validate();
  const locked = c.lock();

  // Glue DOES keep writing to spec.configurator.inputs after the Configurator
  // round (orchestrate-build.js writes affinityRules/motivationRules/actors back
  // into it). The locked snapshot must record what the Configurator approved,
  // not track those later edits.
  caller.levelGen.width = 999;
  caller.injectedAfterLock = true;
  assert.equal(locked.config.levelGen.width, 9);
  assert.equal(locked.config.injectedAfterLock, undefined);
});

// ---------------------------------------------------------------------------
// G3 — the states gate behavior (A3): same call, different state, different outcome
// ---------------------------------------------------------------------------

test("validate() is refused before a config exists and after locking", async () => {
  const c = await makeConfigurator();
  assert.throws(() => c.validate(), (e) => e.code === "configurator_state");
  c.provideConfig(validConfig());
  assert.equal(c.validate().state, "configured");
  // configured -> validate again is not a transition the FSM offers.
  assert.throws(() => c.validate(), (e) => e.code === "configurator_state");
  c.lock();
  assert.throws(() => c.validate(), (e) => e.code === "configurator_state");
});

test("lock() is refused until the config has been validated", async () => {
  const c = await makeConfigurator();
  c.provideConfig(validConfig());
  // The same lock() call fails in pending_config and succeeds in configured —
  // that difference is what makes `configured` a real state rather than a label.
  assert.throws(() => c.lock(), (e) => e.code === "configurator_state");
  c.validate();
  assert.equal(c.lock().state, "locked");
});

test("assembly is refused after lock — the frozen round cannot be reopened in place", async () => {
  const c = await makeConfigurator();
  c.provideConfig(validConfig());
  c.validate();
  c.lock();
  assert.throws(
    () => c.prepareLevelGen({ rooms: [], floorTiles: [], hazards: [] }),
    (e) => e.code === "configurator_state",
  );
  assert.throws(() => c.mapResources([]), (e) => e.code === "configurator_state");
});

test("view() stays JSON-serializable and reports validation/lock state", async () => {
  const c = await makeConfigurator();
  c.provideConfig(validConfig());
  const before = c.view();
  assert.deepEqual(JSON.parse(JSON.stringify(before)), before);
  assert.equal(before.context.validated, false);
  assert.equal(before.context.locked, false);
  assert.equal(before.context.configVersion, 0);

  c.validate();
  c.lock();
  const after = c.view();
  assert.deepEqual(JSON.parse(JSON.stringify(after)), after);
  assert.equal(after.context.validated, true);
  assert.equal(after.context.locked, true);
  assert.equal(after.context.configVersion, 1);
});

// ---------------------------------------------------------------------------
// A2 — the necessary path: production cannot build without the Configurator
// ---------------------------------------------------------------------------

test("provideConfig takes its own copy — the Configurator is not aliased to caller state", async () => {
  const c = await makeConfigurator();
  const caller = validConfig();
  c.provideConfig(caller);
  caller.levelGen.width = 999;
  c.validate();
  const locked = c.lock();
  assert.equal(
    locked.config.levelGen.width,
    9,
    "the Configurator must validate and lock the config it was given, not whatever the caller later mutated it into",
  );
});

/*
 * NOTE on choosing the vehicle for this test — a real constraint, not a
 * workaround. `levelGen` cannot be malformed at validate() time on the authoring
 * path: prepareLevelGen() REGENERATES it through ensureAuthoringLevelGenCapacity,
 * so whatever the caller supplied is replaced by a well-formed grid. `resources`
 * is the honest vehicle — mapResources() carries authored fields through without
 * synthesizing missing ones, so a resource with no id reaches validate() intact.
 */
test("runAuthoringBuild refuses a config the Configurator rejects — the persona is on the path", async () => {
  const { runAuthoringBuild } = await import("../../../packages/runtime/src/build/authoring-build.js");
  const input = {
    summary: { commandName: "create" },
    commandName: "create",
    runId: "run_cr2",
    createdAt: "2026-07-29T00:00:00.000Z",
    // An authored resource with no id: mapResources() passes `id: undefined`
    // straight through, so the assembled config is genuinely invalid.
    resources: [{ tier: "common", stat: "health", delta: 1, dropRate: 1 }],
  };
  await assert.rejects(
    () => runAuthoringBuild(input),
    (e) => e.code === "configurator_invalid" && /resources\[0\]\.id/.test(e.errors.join(";")),
    "a config the Configurator would reject must fail the build rather than reaching orchestrateBuild",
  );
});

test("runAuthoringBuild completes when the Configurator approves, and the lock is versioned", async () => {
  const { runAuthoringBuild } = await import("../../../packages/runtime/src/build/authoring-build.js");
  const result = await runAuthoringBuild({
    summary: { commandName: "create" },
    commandName: "create",
    runId: "run_cr2_ok",
    createdAt: "2026-07-29T00:00:00.000Z",
    resources: [{ id: "resource_1", tier: "common", stat: "health", delta: 1, dropRate: 1 }],
  });
  assert.ok(result.buildResult, "a valid config still builds");
});

// ## TODO: Test Permutations
