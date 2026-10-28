/**
 * #396 — the Director owns the tactic list a plan carries: `ambush`, `retinue`, ...
 * It reads the authored form, refuses an unknown tactic with a reason, and puts the list
 * in the plan (`directives.tactics`) and the BuildSpec (`plan.hints.tactics`). The
 * Configurator compiles tactics in later steps; this only carries them through.
 */
const assert = require("node:assert/strict");

const CREATED_AT = "2026-10-18T00:00:00.000Z";

async function load() {
  return import("../../../packages/runtime/src/personas/director/controller.js");
}

test("a tactic spec reads as { tactic, params }, numbers kept as numbers", async () => {
  const { createDirectorPersona } = await load();
  const director = createDirectorPersona({ clock: () => CREATED_AT });
  assert.deepEqual(director.parseTactic("ambush;guards=2;room=r1"),
    { tactic: "ambush", params: { guards: 2, room: "r1" } });
  assert.deepEqual(director.parseTactic(" retinue "), { tactic: "retinue" });
});

test("an unknown tactic, an empty one or a bad param is refused with a reason", async () => {
  const { createDirectorPersona, PLAN_TACTIC_IDS } = await load();
  const director = createDirectorPersona({ clock: () => CREATED_AT });
  assert.deepEqual([...PLAN_TACTIC_IDS], ["ambush", "retinue", "minefield", "shrine"]);
  assert.throws(() => director.parseTactic("flank"), /unknown tactic "flank".*ambush, retinue, minefield, shrine/);
  assert.throws(() => director.parseTactic(""), /tactic/);
  assert.throws(() => director.parseTactic("ambush;guards"), /guards.*key=value/);
  assert.throws(() => director.normalizeTactics([{ tactic: "ambush", params: { guards: [2] } }]), /guards/);
  assert.throws(() => director.normalizeTactics({ tactic: "ambush" }), /list/);
});

test("normalizeTactics accepts strings and objects alike, in order", async () => {
  const { createDirectorPersona } = await load();
  const director = createDirectorPersona({ clock: () => CREATED_AT });
  assert.deepEqual(director.normalizeTactics(["retinue;size=3", { tactic: "ambush", params: { guards: 1 } }]),
    [{ tactic: "retinue", params: { size: 3 } }, { tactic: "ambush", params: { guards: 1 } }]);
  assert.deepEqual(director.normalizeTactics(undefined), []);
});

test("the plan carries the tactics as directives, and the BuildSpec as plan hints", async () => {
  const { createDirectorPersona } = await load();
  const director = createDirectorPersona({ clock: () => CREATED_AT });
  const tactics = director.normalizeTactics(["ambush;guards=2"]);
  const { planArtifact } = director.beginBuild({
    schema: "agent-kernel/IntentEnvelope", schemaVersion: 1,
    meta: { id: "intent_t", runId: "run_t", createdAt: CREATED_AT, producedBy: "cli" },
    source: "cli-create", intent: { goal: "tactics", hints: { tactics } },
  }, { runId: "run_t" });
  assert.deepEqual(planArtifact.directives.tactics, tactics);
  const built = director.assembleBuildSpec({ summary: { goal: "tactics", tactics }, runId: "run_t", createdAt: CREATED_AT, source: "cli-create" });
  assert.equal(built.ok, true, built.errors?.join("; "));
  assert.deepEqual(built.spec.plan.hints.tactics, tactics);
});

test("a tactic that adds things of its own names the budget pool it spends from (#418)", async () => {
  const { createDirectorPersona } = await load();
  const director = createDirectorPersona({ clock: () => CREATED_AT });
  assert.deepEqual(director.tacticBudgetPools([{ tactic: "minefield" }, { tactic: "ambush" }, { tactic: "minefield" }]), ["hazards"]);
  assert.deepEqual(director.tacticBudgetPools([{ tactic: "ambush" }, { tactic: "retinue" }]), []);
  // #486: a shrine adds hazards of its own too.
  assert.deepEqual(director.tacticBudgetPools([{ tactic: "shrine" }]), ["hazards"]);
  assert.deepEqual(director.tacticBudgetPools(undefined), []);
});

test("a BuildSpec without tactics carries no tactic field", async () => {
  const { createDirectorPersona } = await load();
  const director = createDirectorPersona({ clock: () => CREATED_AT });
  director.beginBuild({
    schema: "agent-kernel/IntentEnvelope", schemaVersion: 1,
    meta: { id: "intent_n", runId: "run_n", createdAt: CREATED_AT, producedBy: "cli" },
    source: "cli-create", intent: { goal: "none" },
  }, { runId: "run_n" });
  const built = director.assembleBuildSpec({ summary: { goal: "none" }, runId: "run_n", createdAt: CREATED_AT, source: "cli-create" });
  assert.equal("tactics" in built.spec.plan.hints, false);
});

// ## TODO: Test Permutations
// - params with negative and decimal numbers keep their sign and fraction
// - a duplicate tactic id is kept twice, in order
// - an object tactic with an unknown id is refused like the string form

// #401: `--tactic auto` — the Director picks a seeded mix from the catalogue.
test("pickSeededTactics: same seed, same plan; picks fit the level's wardens and resources", async () => {
  const { createDirectorPersona } = await load();
  const director = createDirectorPersona({ clock: () => CREATED_AT });
  const counts = { wardens: 3, resources: 2 };
  for (let seed = 0; seed < 50; seed += 1) {
    const plan = director.pickSeededTactics(seed, counts);
    assert.deepEqual(director.pickSeededTactics(seed, counts), plan);
    assert.ok(plan.length >= 1);
    // An ordinary tactic list: it normalizes to itself, in catalogue order.
    assert.deepEqual(director.normalizeTactics(plan), plan);
    const ids = plan.map((entry) => entry.tactic);
    assert.deepEqual(ids, ["ambush", "retinue", "minefield"].filter((id) => ids.includes(id)));
  }
  // No warden: only the minefield fits. A warden but no resource: no ambush.
  for (let seed = 0; seed < 20; seed += 1) {
    assert.deepEqual(director.pickSeededTactics(seed, { wardens: 0, resources: 3 }).map((e) => e.tactic), ["minefield"]);
    assert.ok(!director.pickSeededTactics(seed, { wardens: 2, resources: 0 }).some((e) => e.tactic === "ambush"));
    // One warden can't both lead a retinue and guard an ambush.
    const one = director.pickSeededTactics(seed, { wardens: 1, resources: 1 }).map((e) => e.tactic);
    assert.ok(!(one.includes("ambush") && one.includes("retinue")), one.join(","));
  }
  assert.throws(() => director.pickSeededTactics(-1, counts), /seed/);
});

test("pickSeededTactics: different seeds usually give different plans", async () => {
  const { createDirectorPersona } = await load();
  const director = createDirectorPersona({ clock: () => CREATED_AT });
  const plans = new Set();
  for (let seed = 0; seed < 100; seed += 1) plans.add(JSON.stringify(director.pickSeededTactics(seed, { wardens: 3, resources: 2 })));
  assert.ok(plans.size >= 25, `only ${plans.size} distinct plans over 100 seeds`);
});
