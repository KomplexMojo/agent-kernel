/**
 * #400 — the `retinue` tactic: a leader warden gets `size` minions seated within 2 of it.
 * Each minion's loadout comes from the affinity table, never picked per kind. The roles fill
 * in order (shield, support, striker, then again):
 * - shield: emits the leader's own kind;
 * - support: pushes the restoring kind that acts on the leader's defeat vital (healing reaches anyone);
 * - striker: the leader's kind in the first harmful expression the leader lacks.
 * Minions are ordinary wardens, priced by the Allocator from the warden share. A retinue the
 * share cannot afford shrinks, and the report row says so.
 */
"use strict";

const assert = require("node:assert/strict");

const CREATED_AT = "2026-10-18T00:00:00.000Z";
const KINDS = ["fire", "water", "earth", "wind", "growth", "decay", "corrode", "fortify", "light", "dark"];
const EXPRESSIONS = ["push", "pull", "emit", "draw"];
const vitals = () => ({ health: { current: 10, max: 10, regen: 1 } });
const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

function warden(id, kind, expressions = ["push"]) {
  return { id, category: "warden", motivations: ["defending"], vitals: vitals(),
    affinities: expressions.map((expression) => ({ kind, expression, stacks: 2 })),
    activeAffinityKey: `${kind}:${expressions[0]}` };
}

// The role rule, stated straight from core's table so the test does not share the Configurator's code.
async function expectedRoles(kind, leaderExpressions) {
  const { AFFINITY_TABLE } = await import("../../../packages/core-ts/src/state/affinity-table.ts");
  const row = AFFINITY_TABLE.find((entry) => entry.kind === kind);
  const restorer = AFFINITY_TABLE.find((entry) => entry.outward === "restore" && entry.primaryVital === "health");
  const harmful = EXPRESSIONS.filter((expression) => ["pull", "draw"].includes(expression) || row.outward === "damage");
  const striker = harmful.find((expression) => !leaderExpressions.includes(expression)) ?? harmful[0];
  return {
    shield: { kind, expression: "emit" },
    support: { kind: restorer.kind, expression: "push" },
    striker: { kind, expression: striker },
  };
}

async function compile({ kind = "fire", expressions, params = {}, actors } = {}) {
  const { createConfiguratorPersona } = await import("../../../packages/runtime/src/personas/configurator/controller.js");
  const configurator = createConfiguratorPersona({ clock: () => CREATED_AT });
  return configurator.compileTactics({
    tactics: [{ tactic: "retinue", params }],
    layout: { rooms: [{ id: "R1", x: 1, y: 1, width: 8, height: 8 }] },
    actors: actors || [warden("boss", kind, expressions)],
    seed: 0,
  });
}

test("each role's loadout comes from the affinity table, for every kind as leader", async () => {
  for (const kind of KINDS) {
    for (const expressions of [["push"], ["push", "pull"]]) {
      const { actors, placement, report } = await compile({ kind, expressions, params: { leader: "boss", size: 3 } });
      const expected = await expectedRoles(kind, expressions);
      const label = `${kind} leader with ${expressions.join("+")}`;
      assert.deepEqual(report[0].minions.map((minion) => minion.role), ["shield", "support", "striker"], label);
      for (const { id, role } of report[0].minions) {
        const minion = actors.find((actor) => actor.id === id);
        assert.equal(minion.category, "warden", label);
        assert.deepEqual(minion.motivations, ["defending"], `${label}: minions share the leader's motivations`);
        const { kind: gotKind, expression } = minion.affinities[0];
        assert.deepEqual({ kind: gotKind, expression }, expected[role], `${label} ${role}`);
        assert.equal(minion.activeAffinityKey, `${gotKind}:${expression}`, label);
        assert.ok(placement.some((constraint) => constraint.subject.ref === id
          && constraint.near?.target?.kind === "warden" && constraint.near.target.ref === "boss"
          && constraint.near.distance === 2), `${label}: ${id} is seated within 2 of the leader`);
      }
    }
  }
});

test("roles repeat in order past three; the leader defaults to the first free warden", async () => {
  const { report } = await compile({ params: { size: 5 },
    actors: [warden("b_warden", "water"), warden("a_warden", "fire")] });
  assert.equal(report[0].applied, true);
  assert.equal(report[0].leader, "a_warden");
  assert.deepEqual(report[0].minions.map((minion) => minion.role), ["shield", "support", "striker", "shield", "support"]);
});

test("a bad retinue is refused with a reason", async () => {
  await assert.rejects(compile({ params: { leader: "ghost" } }), /no warden or delver "ghost"/);
  await assert.rejects(compile({ params: { szie: 2 } }), /unknown param szie/);
  await assert.rejects(compile({ params: { size: -1 } }), /size must be a whole number/);
  const none = await compile({ actors: [] });
  assert.equal(none.report[0].applied, false);
  assert.match(none.report[0].note, /no warden to lead/);
});

function spec({ tactics, budget }) {
  return {
    schema: "agent-kernel/BuildSpec",
    schemaVersion: 1,
    meta: { id: "retinue", runId: "retinue", createdAt: CREATED_AT, source: "runtime-test" },
    intent: { goal: "a boss and its retinue" },
    plan: { hints: { tactics } },
    ...(budget ? { budget: { budget: { schema: "agent-kernel/BudgetArtifact", schemaVersion: 1,
      meta: { id: "budget", runId: "retinue", createdAt: CREATED_AT, producedBy: "runtime-test" },
      budget: { tokens: budget } } } } : {}),
    configurator: {
      inputs: {
        levelGen: {
          width: 40, height: 30, seed: 5,
          shape: { roomCount: 5, roomMinSize: 5, roomMaxSize: 7, corridorWidth: 1 },
          connectivity: { requirePath: true },
        },
        delverCount: 1,
        actors: [
          { id: "hero", category: "delver", motivations: ["exploring"], vitals: vitals() },
          warden("boss", "decay"),
        ],
        movementStamina: {},
      },
    },
  };
}

async function build(args) {
  const { orchestrateBuild } = await import("../../../packages/runtime/src/build/orchestrate-build.js");
  const { createConfiguratorPersona } = await import("../../../packages/runtime/src/personas/configurator/persona.js");
  const { createHostedObjectPlacer } = await import("../../../packages/runtime/src/commands/solver-host.js");
  const { createHybridConstraintSolverAdapter } = await import("../../../packages/adapters-cli/src/adapters/z3/index.js");
  const configurator = createConfiguratorPersona({ clock: () => CREATED_AT });
  const placeObjects = createHostedObjectPlacer({ prepare: configurator.prepareObjectPlacement,
    complete: configurator.completeObjectPlacement, adapter: createHybridConstraintSolverAdapter(), clock: () => CREATED_AT });
  const result = await orchestrateBuild({ spec: spec(args), producedBy: "runtime-test", placeObjects });
  const seats = Object.fromEntries(result.initialState.actors.map((actor) => [actor.id, actor.position]));
  return { result, seats, row: result.tacticReport.find((entry) => entry.tactic === "retinue") };
}

test("a built retinue stands within 2 of its leader and is priced from the warden share", async () => {
  const { result, seats, row } = await build({ tactics: [{ tactic: "retinue", params: { leader: "boss", size: 3 } }] });
  assert.equal(row.applied, true, row.note);
  assert.equal(row.minions.length, 3);
  for (const { id } of row.minions) {
    assert.ok(seats[id], `${id} is in the level`);
    assert.ok(chebyshev(seats[id], seats.boss) <= 2, `${id} at ${JSON.stringify(seats[id])}, boss at ${JSON.stringify(seats.boss)}`);
    assert.ok(result.budgetReceipt.lineItems.some((item) => item.id === "actor_spawn" && item.category === "wardens"
      && item.subjectRef?.id === id), `${id} is priced as a warden`);
  }
});

test("a retinue the warden share cannot afford shrinks, and the row says so", async () => {
  const { result, seats, row } = await build({ tactics: [{ tactic: "retinue", params: { leader: "boss", size: 6 } }] });
  assert.ok(row.minions.length < 6, `kept ${row.minions.length}`);
  assert.match(row.note, new RegExp(`the warden share affords ${row.minions.length} of 6 minions`));
  assert.equal(result.budgetReceipt.status, "approved");
  for (const { id } of row.minions) assert.ok(seats[id], id);
  const ids = new Set(result.initialState.actors.map((actor) => actor.id));
  assert.equal([...ids].filter((id) => id.startsWith("boss_minion_")).length, row.minions.length, "dropped minions are not in the level");
});

// ## TODO: Test Permutations
// - two retinues with different leaders do not share minions
// - a leader named by an authored --place constraint still gets its retinue
// - size=0 leaves the leader alone and applied
// - a leader with no affinity: support and striker only, shield skipped with a note

// 2026-10-29: the player's own minions. A delver may lead a retinue; its minions are delvers
// that escort it and take its orders, never playable, with the same role loadouts.
test("a delver leads a retinue of escorting, orderable delvers in the roles it names", async () => {
  const hero = { id: "hero-1", category: "delver", motivations: ["user_controlled"], vitals: vitals(),
    affinities: [{ kind: "fire", expression: "push", stacks: 2 }], activeAffinityKey: "fire:push" };
  const { actors, placement, report } = await compile({ actors: [hero], params: { leader: "hero-1", roles: "striker+shield" } });
  const expected = await expectedRoles("fire", ["push"]);
  assert.deepEqual(report[0].minions.map((minion) => minion.role), ["striker", "shield"]);
  for (const { id, role } of report[0].minions) {
    const minion = actors.find((actor) => actor.id === id);
    assert.equal(minion.category, "delver");
    assert.deepEqual(minion.motivations, ["escorting", "friendly"], "never user_controlled");
    assert.deepEqual(minion.escort, { target: "hero-1", distance: 1 }, "beside it: bare sight is one tile");
    assert.deepEqual({ kind: minion.affinities[0].kind, expression: minion.affinities[0].expression }, expected[role]);
  }
  assert.deepEqual(placement, [], "they start with it, seated as delvers are: no placement question");
});

test("roles must be known, joined with +, and agree with size", async () => {
  await assert.rejects(compile({ params: { leader: "boss", roles: "shield+healer" } }), /unknown role healer/);
  await assert.rejects(compile({ params: { leader: "boss", roles: "shield", size: 2 } }), /size 2 does not match the 1 roles/);
  const noKind = { id: "hero-1", category: "delver", motivations: ["user_controlled"], vitals: vitals(), affinities: [] };
  const { report } = await compile({ actors: [noKind], params: { leader: "hero-1", roles: "shield+support" } });
  assert.deepEqual(report[0].minions.map((minion) => minion.role), ["support"], "a role the leader cannot fill is left out");
  assert.match(report[0].note, /1 of 2 named roles need an affinity kind hero-1 lacks/);
});
