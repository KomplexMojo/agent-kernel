/**
 * P1.5 finding 2 — budget category ids are core-owned and runtime maps names
 * onto them (maintainer decision 2026-07-20).
 *
 * The bug this pins closed: runtime carried its own invented numbering, so a
 * cap named "effects" resolved to id 3 — an index core never charges. The cap
 * was inert (usage stayed 0, the real category stayed unlimited, and NO
 * LimitReached/LimitViolated was ever emitted), while "cognition" (1)
 * accidentally capped effect actions.
 *
 * These are behavior tests: for each supported name we prove the full chain
 * cap → charge → limit event, not just the id mapping.
 */
const assert = require("node:assert/strict");

const CORE = "../../../packages/core-ts/src/index.ts";
const CATEGORIES = "../../../packages/runtime/src/contracts/budget-categories.js";
const PORT = "../../../packages/runtime/src/ports/budget.js";

// Core action kind codes (validate/inputs.ts) and effect kinds (ports/effects.js).
const EMIT_LOG = 2;
const REQUEST_EXTERNAL_FACT = 4;
const LIMIT_REACHED = 4;
const LIMIT_VIOLATED = 5;

function effectKinds(core) {
  const kinds = [];
  for (let i = 0; i < core.getEffectCount(); i += 1) kinds.push(core.getEffectKind(i));
  return kinds;
}

async function capViaPort(capName, cap) {
  const { createCore } = await import(CORE);
  const { applyBudgetCaps } = await import(PORT);
  const core = createCore();
  core.init(0);
  const applied = applyBudgetCaps(core, { constraints: { categoryCaps: { caps: { [capName]: cap } } } });
  return { core, applied };
}

test("core owns the ids; runtime maps names onto them", async () => {
  const { BudgetCategory } = await import(CORE);
  const { BUDGET_CATEGORY_IDS, resolveBudgetCategoryId } = await import(CATEGORIES);
  assert.equal(BUDGET_CATEGORY_IDS.effects, BudgetCategory.Effects);
  assert.equal(BUDGET_CATEGORY_IDS.default, BudgetCategory.Default);
  assert.equal(BUDGET_CATEGORY_IDS.movement, BudgetCategory.Default, "legacy alias for Default");
  assert.equal(resolveBudgetCategoryId("effects"), BudgetCategory.Effects);
  // Numeric escape hatch preserved.
  assert.equal(resolveBudgetCategoryId(2), 2);
  assert.equal(resolveBudgetCategoryId("2"), 2);
  // Names core does not model are NOT invented — they resolve to null and are
  // skipped, rather than silently capping the wrong category.
  assert.equal(resolveBudgetCategoryId("cognition"), null);
  assert.equal(resolveBudgetCategoryId("nonsense"), null);
});

test("an 'effects' cap actually enforces: charge lands, limit events fire", async () => {
  const { BudgetCategory } = await import(CORE);
  const { core, applied } = await capViaPort("effects", 1);
  assert.equal(applied.length, 1);
  assert.equal(applied[0].categoryId, BudgetCategory.Effects);

  core.applyAction(REQUEST_EXTERNAL_FACT, 0);
  assert.equal(core.getBudgetUsage(BudgetCategory.Effects), 1, "charge lands on the capped category");
  assert.ok(effectKinds(core).includes(LIMIT_REACHED), "LimitReached at the cap");

  core.applyAction(REQUEST_EXTERNAL_FACT, 0);
  assert.equal(core.getBudgetUsage(BudgetCategory.Effects), 2);
  assert.ok(effectKinds(core).includes(LIMIT_VIOLATED), "LimitViolated past the cap");
});

test("a 'movement'/'default' cap enforces the non-request action category", async () => {
  const { BudgetCategory } = await import(CORE);
  const { core } = await capViaPort("movement", 1);
  core.applyAction(EMIT_LOG, 1);
  assert.equal(core.getBudgetUsage(BudgetCategory.Default), 1);
  assert.ok(effectKinds(core).includes(LIMIT_REACHED));
});

test("effect actions do NOT consume the default category (and vice versa)", async () => {
  const { BudgetCategory } = await import(CORE);
  const { core } = await capViaPort("effects", 5);
  core.applyAction(REQUEST_EXTERNAL_FACT, 0);
  assert.equal(core.getBudgetUsage(BudgetCategory.Effects), 1);
  assert.equal(core.getBudgetUsage(BudgetCategory.Default), 0, "no cross-category leakage");
});

test("unknown cap names are skipped, not misapplied to some other category", async () => {
  const { core, applied } = await capViaPort("cognition", 1);
  assert.equal(applied.length, 0, "unmodelled name applies no cap");
  // Firing effect actions must not trip a limit, because nothing was capped.
  core.applyAction(REQUEST_EXTERNAL_FACT, 0);
  core.applyAction(REQUEST_EXTERNAL_FACT, 0);
  const kinds = effectKinds(core);
  assert.ok(!kinds.includes(LIMIT_REACHED) && !kinds.includes(LIMIT_VIOLATED));
});

// ## TODO: Test Permutations
// - cap of 0 on each category: first action immediately violates
// - numeric-id caps (e.g. "1") reach Effects identically to the name
// - multiple caps in one simConfig applied independently
// - cap applied twice (re-init) resets usage via core.init
