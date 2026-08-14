/**
 * P1.1 — ALLOCATOR CONTROLLER API (Persona Enforcement Program, local-codex/Plan.md)
 *
 * The Allocator controller becomes the single entry point for pricing and
 * spend decisions (charter: "Economy — Allocator Authority"). This is the API
 * P1.3 threads every call site through. Internals (validate-spend, layout-spend,
 * motivation-price-policy, default-price-list, incentive-model)
 * become private to the persona.
 *
 * Design rules under test:
 * - Pricing (quotes, the price list itself) is read-only policy: any state.
 * - Spend decisions are state-gated: no receipt without a registered budget —
 *   the FSM states finally gate real behavior (charter Persona rule 4).
 * - The tick-loop interface (subscribePhases/advance/view) is unchanged.
 * - Everything is synchronous, deterministic, and serializable.
 */
const assert = require("node:assert/strict");

const P = "../../../packages/runtime/src/personas/allocator/";

const BUDGET = Object.freeze({
  schema: "agent-kernel/BudgetArtifact",
  schemaVersion: 1,
  meta: { id: "budget_test" },
  budget: { tokens: 500 },
});

const PROPOSAL = Object.freeze({
  items: [
    { id: "actor_spawn", kind: "actor", quantity: 2 },
    { id: "motivation_exploring", kind: "motivation", quantity: 1 },
  ],
});

async function makeAllocator(options = {}) {
  const { createAllocatorPersona } = await import(`${P}persona.js`);
  // CR.9 M2: room tile counts are Configurator geometry, injected into the Allocator
  // at construction (mirroring CR.6's admitProposals). Production wires the real
  // Configurator; so does this, rather than a stub, so the test exercises the
  // capability the persona actually receives.
  const { createConfiguratorPersona } = await import(`${P}../configurator/persona.js`);
  const deriveRoomLayout = createConfiguratorPersona({ clock: () => "2026-07-18T00:00:00.000Z" }).deriveRoomLayout;
  return createAllocatorPersona({ clock: () => "2026-07-18T00:00:00.000Z", deriveRoomLayout, ...options });
}

// ── Tick interface unchanged ──

test("tick interface: subscribePhases/advance/view still behave as before", async () => {
  const a = await makeAllocator();
  assert.deepEqual([...a.subscribePhases], ["observe", "decide"]);
  assert.equal(a.view().state, "idle");
  const r = a.advance({ phase: "observe", event: "budget", payload: { budgets: [BUDGET] }, tick: 1 });
  assert.equal(r.state, "budgeting");
});

// ── Pricing surface: read-only, any state ──

test("pricing.priceList() is the default list stamped by the INJECTED clock, never the wall clock", async () => {
  const a = await makeAllocator();
  const { buildDefaultPriceList } = await import(`${P}default-price-list.js`);
  const list = a.pricing.priceList();
  const fresh = buildDefaultPriceList();
  assert.deepEqual(list.items, fresh.items);
  assert.equal(list.schema, fresh.schema);
  // Charter: clock injected. The artifact's createdAt must come from the
  // persona's clock — comparing against a fresh wall-clock build is a race.
  assert.equal(list.meta.createdAt, "2026-07-18T00:00:00.000Z");
  const map = a.pricing.priceMap();
  assert.equal(map.get("actor:actor_spawn").unitCost, 5);
  assert.equal(a.pricing.unitCosts().get("actor:actor_spawn"), 5);
});

test("pricing honors caller-supplied priceListMeta (run-scoped determinism for glue)", async () => {
  const meta = { id: "run-price-list", runId: "run_42", createdAt: "2026-07-18T00:00:00.000Z", producedBy: "allocator" };
  const a = await makeAllocator({ priceListMeta: meta });
  assert.deepEqual(a.pricing.priceList().meta, meta);
});

test("pricing honors an injected price list", async () => {
  const custom = {
    schema: "agent-kernel/PriceList",
    schemaVersion: 1,
    meta: { id: "custom" },
    items: [{ id: "actor_spawn", kind: "actor", unitCost: 99 }],
  };
  const a = await makeAllocator({ priceList: custom });
  assert.equal(a.pricing.priceMap().get("actor:actor_spawn").unitCost, 99);
});

test("pricing.quoteMotivations uses the persona's own price map (no silent divergence)", async () => {
  const a = await makeAllocator();
  const quote = a.pricing.quoteMotivations([{ kind: "exploring" }, { kind: "attacking" }]);
  assert.equal(quote.cost, 5, "list prices 2 + 3, not the 25/25 fallback");
});

// ── Spend surface: state-gated ──

test("validateSpend REFUSES without a registered budget — idle state gates receipts", async () => {
  const a = await makeAllocator();
  assert.throws(
    () => a.validateSpend({ proposal: PROPOSAL }),
    (err) => err.code === "allocator_state" && /idle/.test(err.message),
  );
  assert.equal(a.view().state, "idle", "refusal does not advance the FSM");
});

test("registerBudget advances idle→budgeting; validateSpend advances to allocating and issues the receipt", async () => {
  const a = await makeAllocator();
  a.registerBudget(BUDGET);
  assert.equal(a.view().state, "budgeting");

  const { receipt, errors } = a.validateSpend({ proposal: PROPOSAL, meta: { id: "receipt_test" } });
  assert.equal(errors, undefined);
  assert.equal(a.view().state, "allocating");
  assert.equal(receipt.schema, "agent-kernel/BudgetReceiptArtifact");
  assert.equal(receipt.status, "approved");
  // actor_spawn 2×5 + motivation_exploring 1×2 = 12
  assert.equal(receipt.totalCost, 12);
  assert.equal(receipt.remaining, 488);
});

test("validateSpend matches a direct validateSpendProposal call — the controller adds gating, not math", async () => {
  const a = await makeAllocator();
  const { validateSpendProposal } = await import(`${P}validate-spend.js`);
  a.registerBudget(BUDGET);
  const viaController = a.validateSpend({ proposal: PROPOSAL, meta: { id: "m" } });
  const direct = validateSpendProposal({
    budget: BUDGET,
    priceList: a.pricing.priceList(),
    proposal: PROPOSAL,
    meta: { id: "m" },
  });
  assert.deepEqual(viaController.receipt, direct.receipt);
});

test("registerBudget is idle-only; re-registering mid-round throws", async () => {
  const a = await makeAllocator();
  a.registerBudget(BUDGET);
  assert.throws(() => a.registerBudget(BUDGET), (err) => err.code === "allocator_state");
});

test("a denied proposal still returns a receipt (denial IS a decision) and stays allocating", async () => {
  const a = await makeAllocator();
  a.registerBudget({ ...BUDGET, budget: { tokens: 3 } });
  const { receipt } = a.validateSpend({ proposal: PROPOSAL });
  assert.equal(receipt.status, "denied");
  assert.equal(a.view().state, "allocating");
});

// ── Layout + report passthroughs, and FSM transitions ──

test("evaluateRoomCardLayoutSpend works through the controller with the persona's price list", async () => {
  const a = await makeAllocator();
  const result = a.evaluateRoomCardLayoutSpend({
    cardSet: [{ type: "room", source: "room", count: 1, size: "small" }],
    budgetTokens: 1000,
  });
  assert.ok(Number.isFinite(result.spentTokens));
});

// Replaces the deleted updateLedger test (P3.3 removed the never-wired BudgetLedgerArtifact).
// That test was the only unit coverage of allocating→monitoring, so the transition is re-covered
// here through the route production actually uses: the tick loop sends the "monitor" event
// (runtime-fsm.mjs:822), NOT a ledger update. Keeping this prevents `monitoring` from quietly
// becoming an unexercised state — which the charter treats as a defect in its own right.
test("allocating→monitoring advances on the tick-plane monitor event", async () => {
  const a = await makeAllocator();
  a.registerBudget(BUDGET);
  a.validateSpend({ proposal: PROPOSAL });
  assert.equal(a.view().state, "allocating");

  a.advance({ phase: "observe", event: "monitor", payload: {}, tick: 1 });
  assert.equal(a.view().state, "monitoring");
});

// ── Determinism and serialization ──

test("view() is JSON-serializable and reflects the spend round", async () => {
  const a = await makeAllocator();
  a.registerBudget(BUDGET);
  a.validateSpend({ proposal: PROPOSAL });
  const v = a.view();
  assert.deepEqual(JSON.parse(JSON.stringify(v)), v);
  assert.equal(v.context.budgetTokens, 500);
  assert.equal(v.context.receiptCount, 1);
});

test("same inputs, same outputs: two personas produce identical receipts", async () => {
  const a = await makeAllocator();
  const b = await makeAllocator();
  a.registerBudget(BUDGET);
  b.registerBudget(BUDGET);
  assert.deepEqual(
    a.validateSpend({ proposal: PROPOSAL, meta: { id: "m" } }),
    b.validateSpend({ proposal: PROPOSAL, meta: { id: "m" } }),
  );
});

// ## TODO: Test Permutations
// - validateSpend with an unknown price id: receipt partial/denied shape via controller
// - registerBudget with invalid budget artifact (no tokens): error shape
// - evaluateLayoutSpend passthrough with explicit tileCosts override
// - scenarioSpendReport passthrough determinism
// - monitoring→rebalancing via tick advance interleaved with service calls
