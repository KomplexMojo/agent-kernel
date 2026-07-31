/**
 * Allocator service surface — the synchronous API behind the controller.
 *
 * This is the single entry point for pricing and spend decisions (charter:
 * "Economy — Allocator Authority"). The sibling modules it fronts
 * (validate-spend, layout-spend, motivation-price-policy, default-price-list,
 * incentive-model, budget-fulfillment) are persona internals: nothing outside
 * personas/allocator/ may import them directly (tests/architecture/
 * persona-boundary.test.js enforces this; the allowlist shrinks as call sites
 * migrate in P1.3).
 *
 * State gating: pricing is read-only policy and available in any state; spend
 * decisions require the FSM round — registerBudget (idle→budgeting) before
 * validateSpend (→allocating); the tick loop then drives allocating→monitoring
 * with the "monitor" event. The states gate real behavior; a receipt cannot
 * exist without a registered budget.
 *
 * Shared by controller.js and controller.mts so the two entry points cannot
 * drift.
 */
import BASE_COSTS from "./base-costs.json" with { type: "json" };
import { buildDefaultPriceList } from "./default-price-list.js";
import { normalizePriceItems, buildPriceMap, validateSpendProposal } from "./validate-spend.js";
import { evaluateLayoutSpend, evaluateRoomCardLayoutSpend } from "./layout-spend.js";
import { calculateMotivationStackCost } from "./motivation-price-policy.js";
import { buildScenarioSpendReport } from "./incentive-model.js";
import { computeBudgetPools, DEFAULT_BUDGET_POOLS, REFERENCE_BUDGET_TOKENS } from "./budget-allocation.js";
import { ensureBudgetedFulfillmentFeasible, applyBudgetCappedFulfillment } from "./budget-fulfillment.js";

export class AllocatorStateError extends Error {
  constructor(message) {
    super(message);
    this.name = "AllocatorStateError";
    this.code = "allocator_state";
  }
}

export function attachAllocatorServices({ fsm, priceList, priceListMeta, clock } = {}) {
  let resolvedPriceList = null;
  let registeredBudget = null;
  let receiptCount = 0;
  let lastReceiptStatus = null;

  const currentState = () => fsm.view().state;

  function requireState(allowed, operation) {
    const state = currentState();
    if (!allowed.includes(state)) {
      const hint = state === "idle" ? " Register a budget first (registerBudget)." : "";
      throw new AllocatorStateError(
        `Allocator cannot ${operation} in state "${state}" (requires ${allowed.join("|")}).${hint}`,
      );
    }
  }

  function getPriceList() {
    if (!resolvedPriceList) {
      // The injected persona clock stamps the artifact — persona code never
      // reads the wall clock (charter: clock injected). Glue that owns a
      // run-scoped meta (runId/createdAt) passes priceListMeta so the emitted
      // PriceList artifact stays deterministic per run.
      resolvedPriceList = priceList
        || buildDefaultPriceList({
          meta: priceListMeta,
          ...(typeof clock === "function" ? { createdAt: clock() } : {}),
        });
    }
    return resolvedPriceList;
  }

  const pricing = {
    /** The persona's resolved PriceList artifact (injected or the default). */
    priceList: () => getPriceList(),
    /** Map "kind:id" → price item ({ unitCost, formula, ... }). */
    priceMap: () => normalizePriceItems(getPriceList()),
    /** Map "kind:id" → unitCost number (the shape maximizer-style callers use). */
    unitCosts: () => buildPriceMap(getPriceList()),
    /** Motivation stack quote against the persona's own price map. */
    quoteMotivations: (motivations) =>
      calculateMotivationStackCost(motivations, buildPriceMap(getPriceList())),
    /**
     * Runtime action costs charged against core's per-run budget ledger.
     * Distinct from the authoring price list: these are the per-action units
     * core charges while a simulation runs. Names, not core action codes —
     * runtime maps them onto core's ActionKind codebook.
     */
    actionBudgetCosts: () => ({
      default: BASE_COSTS.actionBudget.action_default,
      requestSolver: BASE_COSTS.actionBudget.action_request_solver,
    }),

    /**
     * Split a total token budget into pools (CR.1).
     *
     * The Allocator owns the split; other personas ASK for one rather than
     * computing it. This exists so the Director can bound a hazard proposal
     * against the layout pool without importing the policy — its own controller
     * used to call `computeBudgetPools` directly out of a module that lived in the
     * Director's folder, which is how the economy came to have three origins.
     */
    budgetPools: (args = {}) => computeBudgetPools(args),

    /**
     * The default flat pool weights (rooms .44 · hazards .12 · wardens .16 ·
     * resources .08 · delver .20), derived from the two-tier dungeon/delver split.
     *
     * Exposed because `commands/kernel.js` hand-maintained a byte-identical copy as
     * SUMMARY_POOL_WEIGHT_DEFAULTS (CR.1) — a real duplicate that could diverge,
     * not an alias.
     */
    defaultPoolWeights: () => DEFAULT_BUDGET_POOLS.map((pool) => ({ ...pool })),

    /**
     * Level-authoring economy knobs (CR.1).
     *
     * These were `const`s in `commands/card-authoring.js` — pricing policy declared
     * in glue, feeding calculateCardValue, card receipts, UI guidance and
     * auto-generation, with the UI importing them straight out of the command
     * module. They are the Allocator's to state; callers ask for them.
     *
     * `referenceBudgetTokens` deliberately reads from budget-allocation.js rather
     * than base-costs.json: card-authoring declared its own DEFAULT_LEVEL_BUDGET_TOKENS
     * = 2500 alongside REFERENCE_BUDGET_TOKENS = 2500 — the same reference budget
     * twice. Publishing one value from one place is the point of the finding.
     */
    levelAuthoring: () => ({
      referenceBudgetTokens: REFERENCE_BUDGET_TOKENS,
      resourceVitalCostPerDelta: BASE_COSTS.levelAuthoring.resource_vital_cost_per_delta,
      resourceVitalCostPerRegen: BASE_COSTS.levelAuthoring.resource_vital_cost_per_regen,
      resourcePermanentMultiplier: BASE_COSTS.levelAuthoring.resource_permanent_multiplier,
      roomAffinityStackCostFactor: BASE_COSTS.levelAuthoring.room_affinity_stack_cost_factor,
      // Its own JSON group: the base-cost standard requires every item to be a
      // NUMBER, so a nested split object would be formula selection in JSON.
      budgetSplitPercent: { ...BASE_COSTS.levelBudgetSplitPercent },
    }),
  };

  function registerBudget(budget) {
    requireState(["idle"], "register a budget");
    fsm.advance("budget", { budgets: [budget] });
    registeredBudget = budget;
    return { state: currentState() };
  }

  function validateSpend({ proposal, allocation, meta, budgetRef, priceListRef, proposalRef } = {}) {
    requireState(["budgeting", "allocating"], "validate spend");
    if (currentState() === "budgeting") {
      fsm.advance("allocate", { budgets: [registeredBudget] });
    }
    const result = validateSpendProposal({
      budget: registeredBudget,
      priceList: getPriceList(),
      proposal,
      allocation,
      meta,
      budgetRef,
      priceListRef,
      proposalRef,
    });
    receiptCount += 1;
    lastReceiptStatus = result.receipt?.status ?? null;
    return result;
  }

  function boundEvaluateLayoutSpend(args = {}) {
    return evaluateLayoutSpend({ priceList: getPriceList(), ...args });
  }

  function boundEvaluateRoomCardLayoutSpend(args = {}) {
    return evaluateRoomCardLayoutSpend({ priceList: getPriceList(), ...args });
  }

  function scenarioSpendReport(args = {}) {
    return buildScenarioSpendReport(args);
  }

  // Budget maximization + feasibility (charter: "budget maximization is Allocator
  // policy"). Read-only policy over the caller-supplied budget/price args — like
  // pricing.*, available in any FSM state and NOT gated behind registerBudget:
  // the budget is a per-call argument (split-budget authoring assesses/maximizes
  // twice with two different budgets in one command), not persona state, and
  // neither issues receipts nor mutates the ledger.
  function assessFeasibility(args = {}) {
    return ensureBudgetedFulfillmentFeasible(args);
  }

  function maximizeFulfillment(args = {}) {
    return applyBudgetCappedFulfillment(args);
  }

  /** Serializable service-side context merged into the persona view. */
  function serviceContext() {
    return {
      budgetTokens: registeredBudget?.budget?.tokens ?? null,
      receiptCount,
      lastReceiptStatus,
    };
  }

  return {
    pricing,
    registerBudget,
    validateSpend,
    evaluateLayoutSpend: boundEvaluateLayoutSpend,
    evaluateRoomCardLayoutSpend: boundEvaluateRoomCardLayoutSpend,
    scenarioSpendReport,
    assessFeasibility,
    maximizeFulfillment,
    serviceContext,
  };
}
