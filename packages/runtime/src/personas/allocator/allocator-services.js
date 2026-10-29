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
import { evaluateLayoutSpend, evaluateRoomCardLayoutSpend, resolveLayoutTileCosts } from "./layout-spend.js";
import { calculateMotivationStackCost } from "./motivation-price-policy.js";
import { buildScenarioSpendReport } from "./incentive-model.js";
import {
  buildBudgetAllocation,
  computeBudgetPools,
  DEFAULT_BUDGET_POOLS,
  REFERENCE_BUDGET_TOKENS,
} from "./budget-allocation.js";
import { evaluateSelectionSpend } from "./selection-spend.js";
import {
  completeAllocatorBudgetFit,
  prepareAllocatorBudgetFit,
} from "./budget-fit-problem.js";
import { ensureBudgetedFulfillmentFeasible, applyBudgetCappedFulfillment } from "./budget-fulfillment.js";
import { reconcileBudget } from "./reconciliation.js";
import { priceMixedRoomDesignSpend } from "./mixed-room-spend.js";
import { LEVEL_GRADES, applyLevelGradePoolWeights, reportLevelGrade, resolveLevelGrade } from "./level-grades.js";
import { billedLayoutTiles, calculateActorConfigurationUnitCost, evaluateConfiguratorSpend } from "./spend-proposal.js";
import { BUDGET_ARTIFACT_SCHEMA, BUDGET_RECEIPT_ARTIFACT_SCHEMA, RUNTIME_BUDGET_RECEIPT_SCHEMA } from "../../contracts/artifacts.ts";

const RUNTIME_BUDGET_UNIT = "runtimeBudgetUnits";
const RUNTIME_BUDGET_PRICE_SOURCE = "allocator_runtime_action_price_v1";

function runtimeBudgetReceiptError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export class AllocatorStateError extends Error {
  constructor(message) {
    super(message);
    this.name = "AllocatorStateError";
    this.code = "allocator_state";
  }
}

export function attachAllocatorServices({
  fsm,
  priceList,
  priceListMeta,
  clock,
  deriveRoomLayout,
  authorCandidates,
  normalizeMotivations,
} = {}) {
  let resolvedPriceList = null;
  let registeredBudget = null;
  let receiptCount = 0;
  let lastReceiptStatus = null;
  // P5.5 — the last reconciliation VERDICT. It lives on the service rather than in
  // the FSM context because `view()` is what gets serialized into personaViews and
  // replayed, and an advance() return value is transient: a verdict that existed only
  // on the result object would be invisible to every replay consumer, which is most
  // of them.
  let lastReconciliation = null;

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

  /**
   * Resolve a caller's partial price list against this Allocator's canonical list.
   * Existing `kind:id` keys retain their default insertion slot; the caller's last
   * value wins, and new keyed/legacy entries append in caller order.
   */
  function resolvePriceList(callerPriceList) {
    const defaults = getPriceList();
    if (!callerPriceList) return defaults;
    const itemsByKey = new Map();
    defaults.items.forEach((item) => {
      itemsByKey.set(`${item.kind}:${item.id}`, item);
    });
    if (Array.isArray(callerPriceList.items)) {
      callerPriceList.items.forEach((item) => {
        if (typeof item?.id === "string" && typeof item?.kind === "string") {
          itemsByKey.set(`${item.kind}:${item.id}`, item);
        } else if (typeof item?.key === "string") {
          itemsByKey.set(`legacy:${item.key}`, item);
        }
      });
    }
    return {
      ...defaults,
      ...callerPriceList,
      meta: callerPriceList.meta || defaults.meta,
      items: Array.from(itemsByKey.values()),
    };
  }

  /**
   * Tokens the Configurator may spend expanding actors after a probe receipt.
   * Global remaining budget is always a ceiling. When actor-pool evidence exists,
   * the combined non-negative delver/warden remainder is a second ceiling.
   */
  function resolveActorExpansionAvailability({ receipt } = {}) {
    const globalRemaining = receipt?.remaining ?? 0;
    if (!Array.isArray(receipt?.poolStatuses)) return globalRemaining;
    const actorPools = receipt.poolStatuses.filter(
      (pool) => pool?.id === "delver" || pool?.id === "wardens",
    );
    if (actorPools.length === 0) return globalRemaining;
    const actorPoolRemaining = actorPools.reduce((sum, pool) => {
      const remaining = Number.isFinite(pool?.remainingTokens) ? pool.remainingTokens : 0;
      return sum + Math.max(0, remaining);
    }, 0);
    return Math.min(globalRemaining, actorPoolRemaining);
  }

  /**
   * #400: whether the receipt approves the warden share. A receipt with no warden pool has
   * no share to exceed. The Configurator shrinks a retinue until this holds.
   */
  function wardenShareApproved({ receipt } = {}) {
    const pool = Array.isArray(receipt?.poolStatuses)
      ? receipt.poolStatuses.find((entry) => entry?.id === "wardens") : null;
    return !pool || pool.status === "approved";
  }

  /**
   * Whether the receipt approves the delver share, which pays for a delver's own minions
   * (2026-10-29). A receipt with no delver pool has no share to exceed.
   */
  function delverShareApproved({ receipt } = {}) {
    const pool = Array.isArray(receipt?.poolStatuses)
      ? receipt.poolStatuses.find((entry) => entry?.id === "delver") : null;
    return !pool || pool.status === "approved";
  }

  /**
   * #418: whether the receipt approves the hazard share. A receipt with no hazard pool has
   * no share to exceed. The Configurator shrinks a minefield until this holds.
   */
  function hazardShareApproved({ receipt } = {}) {
    const pool = Array.isArray(receipt?.poolStatuses)
      ? receipt.poolStatuses.find((entry) => entry?.id === "hazards") : null;
    return !pool || pool.status === "approved";
  }

  function boundPriceMixedRoomDesignSpend(args = {}) {
    return priceMixedRoomDesignSpend(
      withPersonaDefaults(args, { priceList: getPriceList() }),
    );
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
     * One actor, spawn included, priced line by line against the persona's own price map:
     * `{ cost, detail: { lineItems }, errors? }`. What an editing screen shows per choice.
     */
    quoteActor: (entry) => {
      const priceMap = normalizePriceItems(getPriceList());
      const quote = calculateActorConfigurationUnitCost({ entry, priceMap, normalizeMotivations });
      const spawn = priceMap.get("actor:actor_spawn");
      if (!spawn) return { ...quote, errors: [...(quote.errors ?? []), 'no price list entry (expected actor:actor_spawn)'] };
      const lineItems = [{ category: "actor", id: spawn.id, label: "actor spawn", quantity: 1, unitCostTokens: spawn.unitCost, spendTokens: spawn.unitCost }, ...quote.detail.lineItems];
      return { ...quote, cost: quote.cost + spawn.unitCost, detail: { ...quote.detail, lineItems } };
    },
    /**
     * Runtime action costs charged against core's per-run budget ledger.
     * Distinct from the authoring price list: these are the per-action units
     * core charges while a simulation runs. Names, not core action codes —
     * runtime maps them onto core's ActionKind codebook.
     */
    runtimeActionCosts: () => ({
      unit: RUNTIME_BUDGET_UNIT,
      source: RUNTIME_BUDGET_PRICE_SOURCE,
      default: BASE_COSTS.actionBudget.action_default,
      wait: BASE_COSTS.actionBudget.action_wait,
      equipAffinity: BASE_COSTS.actionBudget.action_default,
      take: BASE_COSTS.actionBudget.action_default,
      castAffinity: BASE_COSTS.actionBudget.action_cast_affinity,
      requestSolver: BASE_COSTS.actionBudget.action_request_solver,
      move: BASE_COSTS.actionBudget.action_move,
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
      roomAffinityStackCostFactor: BASE_COSTS.levelAuthoring.room_affinity_stack_cost_factor,
      // Its own JSON group: the base-cost standard requires every item to be a
      // NUMBER, so a nested split object would be formula selection in JSON.
      budgetSplitPercent: { ...BASE_COSTS.levelBudgetSplitPercent },
    }),

    /**
     * #422: level difficulty grades H..S. `levelGrades()` lists them easiest first;
     * `levelGrade(id)` is one grade's budget and dungeon/delver percent (unknown → throws,
     * naming the known ones); `levelGradePoolWeights(weights, id)` re-weights a build's
     * pools so the delver pool holds the grade's delver share; `levelGradeReport(id, tokens)`
     * is the grade as a build reports it, with `budgetOverride` when the build's budget differs.
     */
    levelGrades: () => [...LEVEL_GRADES],
    levelGrade: (grade) => resolveLevelGrade(grade),
    levelGradeReport: (grade, builtTokens) => reportLevelGrade(grade, builtTokens),
    levelGradePoolWeights: (poolWeights, grade) => applyLevelGradePoolWeights(poolWeights, grade),
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

  /**
   * Spread `args` first, then fill only what it did not actually supply.
   *
   * CR.9 M5 fixed a real defect here. These were `{ priceList: getPriceList(), ...args }`,
   * and callers routinely pass the KEY with an undefined VALUE (`{ priceList, ... }` where
   * the local is undefined) — which the spread happily uses to overwrite the persona's
   * resolved list with nothing. The persona then priced with no price list. That was
   * invisible while `layout-spend.js` completed missing prices from the contracts default;
   * deleting the default (CR.1) turned it into 128 loud failures across the suite.
   * A `key: undefined` present in an object is not the same as the key being absent, and
   * object spread does not know the difference — so precedence has to be explicit.
   */
  function withPersonaDefaults(args, defaults) {
    const merged = { ...args };
    for (const [key, value] of Object.entries(defaults)) {
      if (merged[key] === undefined) merged[key] = value;
    }
    return merged;
  }

  function boundEvaluateLayoutSpend(args = {}) {
    return evaluateLayoutSpend(withPersonaDefaults(args, { priceList: getPriceList() }));
  }

  function boundEvaluateRoomCardLayoutSpend(args = {}) {
    // CR.9 M2: the injected Configurator geometry is the default, but an explicit
    // per-call `deriveRoomLayout` still wins — same precedence as priceList.
    return evaluateRoomCardLayoutSpend(
      withPersonaDefaults(args, { priceList: getPriceList(), deriveRoomLayout }),
    );
  }

  function scenarioSpendReport(args = {}) {
    return buildScenarioSpendReport(args);
  }

  // CR.4 M5b.2b — the three decisions `llm-budget-loop.js` used to make by importing this
  // persona's internals. All three are pricing (charter: "Economy — Allocator Authority"),
  // and all three were executing inside the Orchestrator.
  //
  // Read-only policy over caller-supplied args, so — like pricing.* and the two layout
  // evaluators above — they are available in any FSM state and are NOT gated behind
  // registerBudget: they issue no receipt and do not touch the ledger.
  //
  // Each takes the persona's price list as a DEFAULT via withPersonaDefaults, so an
  // explicit per-call priceList still wins and a caller passing `priceList: undefined`
  // cannot clobber the persona's own. That precedence is the CR.9 M5 lesson; getting it
  // backwards here would silently reprice a build against the default list, and the
  // resulting number would still look perfectly well-formed.

  function resolveTileCosts(args = {}) {
    // Positional, unlike its siblings — the merge still runs so precedence is identical.
    return resolveLayoutTileCosts(withPersonaDefaults(args, { priceList: getPriceList() }).priceList);
  }

  function allocateBudget(args = {}) {
    return buildBudgetAllocation(withPersonaDefaults(args, { priceList: getPriceList() }));
  }

  // CR.4 M5b.2c — the auto-fit search: revise a layout until it fits the budget. It is here
  // rather than in the Orchestrator because it does not merely CALL pricing, it applies it —
  // its reduction policy picks which tile to drop by that tile's cost.
  function prepareLayoutBudgetFit(args = {}) {
    return prepareAllocatorBudgetFit(
      withPersonaDefaults(args, { priceList: getPriceList(), clock }),
    );
  }

  function completeLayoutBudgetFit(args = {}) {
    return completeAllocatorBudgetFit(
      withPersonaDefaults(args, { priceList: getPriceList(), clock }),
    );
  }

  function boundFitLayoutToBudget(args = {}) {
    const withDefaults = withPersonaDefaults(args, { priceList: getPriceList(), clock });
    return completeAllocatorBudgetFit({
      ...withDefaults,
      prepared: prepareAllocatorBudgetFit(withDefaults),
    });
  }

  // Also defaults the injected Configurator motivation vocabulary (CR.9 M3): selection
  // spend prices raw actor motivations, and the vocabulary is Configurator law that this
  // persona must not restate.
  function boundEvaluateSelectionSpend(args = {}) {
    return evaluateSelectionSpend(
      withPersonaDefaults(args, { priceList: getPriceList(), normalizeMotivations }),
    );
  }

  // Budget maximization + feasibility (charter: "budget maximization is Allocator
  // policy"). Read-only policy over the caller-supplied budget/price args — like
  // pricing.*, available in any FSM state and NOT gated behind registerBudget:
  // the budget is a per-call argument (split-budget authoring assesses/maximizes
  // twice with two different budgets in one command), not persona state, and
  // neither issues receipts nor mutates the ledger.
  // CR.9 M2: both price ROOM cards, so both need the Configurator's geometry
  // threaded down to calculateRoomCardUnitCost. Injected at construction; an
  // explicit per-call value still wins.
  // CR.9 M3: both also ASSEMBLE cards — candidate enumeration for the maximizer,
  // minimum-viable cards and structural validity for the assessor — so both take the
  // Configurator's authoring surface the same way, and refuse without it.
  // These two carried the SAME `{ defaults, ...args }` clobbering bug the layout services
  // above were fixed for — a caller passing `authorCandidates: undefined` would overwrite
  // the injected capability with nothing, and the persona would then refuse (or worse,
  // proceed) for a reason that has nothing to do with what the caller meant. Dormant, in
  // that no current caller does it; migrated anyway, because the fix was for the defect
  // CLASS and leaving two instances of it in the same file is how a class reopens.
  // (Found by the Codex adversarial review of this milestone.)
  function assessFeasibility(args = {}) {
    return ensureBudgetedFulfillmentFeasible(
      withPersonaDefaults(args, { deriveRoomLayout, authorCandidates, normalizeMotivations }),
    );
  }

  function maximizeFulfillment(args = {}) {
    return applyBudgetCappedFulfillment(
      withPersonaDefaults(args, { deriveRoomLayout, authorCandidates, normalizeMotivations }),
    );
  }

  /**
   * Reconcile actual spend against the issued budget (P5.5, charter: the
   * Allocator owns "reconciliation").
   *
   * ⚠️ **State-gated, and this is the gate that makes REBALANCING mean
   * something.** Before P5.5 `monitoring → rebalancing` moved a label and
   * nothing else: advance() behaved identically in every state, so the run
   * reported `rebalancing` while doing exactly what it did in `monitoring`.
   * Reconciliation is the only operation that requires the monitoring loop to
   * have started, so it is the one that turns the edge into a gate — a
   * reconciliation cannot exist before the Allocator is watching a run, the
   * same way a receipt cannot exist without a registered budget.
   *
   * Unlike pricing (read-only policy, available in any state) this touches the
   * run's own ledger, which only exists once the run does.
   */
  function reconcile({ ledger } = {}) {
    requireState(["monitoring", "rebalancing"], "reconcile spend");
    lastReconciliation = reconcileBudget({ ledger });
    return lastReconciliation;
  }

  /**
   * Issue the descriptive runtime receipt from application facts. Runtime owns
   * whether an action was accepted; this persona alone maps that outcome to
   * policy units and totals. It neither reads nor changes core's cap ledger.
   */
  function issueRuntimeBudgetReceipt({ outcomes, meta } = {}) {
    if (!meta || typeof meta !== "object" || typeof meta.id !== "string" || !meta.id.trim()
      || typeof meta.createdAt !== "string" || !meta.createdAt.trim()) {
      throw runtimeBudgetReceiptError(
        "allocator_runtime_budget_meta_required",
        "Runtime budget receipt requires deterministic artifact metadata.",
      );
    }
    if (!Array.isArray(outcomes)) {
      throw runtimeBudgetReceiptError(
        "allocator_runtime_budget_outcomes_required",
        "Runtime budget receipt requires an outcomes array.",
      );
    }

    const costs = pricing.runtimeActionCosts();
    const unitsForAcceptedAction = (actionKind) => {
      if (actionKind === "wait") return costs.wait;
      if (actionKind === "equip_affinity") return costs.equipAffinity;
      if (actionKind === "take") return costs.take;
      if (actionKind === "cast_affinity") return costs.castAffinity;
      if (actionKind === "request_solver") return costs.requestSolver;
      if (actionKind === "move") return costs.move;
      return costs.default;
    };
    const totalsByActor = new Map();
    let unattributedUnits = 0;
    let totalUnits = 0;
    const rows = outcomes.map((outcome, index) => {
      const actorId = typeof outcome?.actorId === "string" && outcome.actorId.trim()
        ? outcome.actorId
        : null;
      const tick = outcome?.tick;
      const actionKind = outcome?.actionKind;
      const outcomeKind = outcome?.outcome;
      const reason = outcome?.reason;
      if (!Number.isInteger(tick) || tick < 0 || typeof actionKind !== "string" || !actionKind.trim()
        || (outcomeKind !== "accepted" && outcomeKind !== "rejected")
        || (reason !== undefined && typeof reason !== "string")) {
        throw runtimeBudgetReceiptError(
          "allocator_runtime_budget_outcome_invalid",
          `Runtime budget outcome ${index} is invalid.`,
        );
      }
      if (outcome?.actorId !== undefined && outcome?.actorId !== null && typeof outcome.actorId !== "string") {
        throw runtimeBudgetReceiptError(
          "allocator_runtime_budget_outcome_invalid",
          `Runtime budget outcome ${index} has a non-string actor id.`,
        );
      }

      const units = outcomeKind === "accepted" ? unitsForAcceptedAction(actionKind) : 0;
      totalUnits += units;
      if (actorId === null) {
        unattributedUnits += units;
      } else {
        totalsByActor.set(actorId, (totalsByActor.get(actorId) || 0) + units);
      }
      return {
        actorId,
        tick,
        actionKind,
        outcome: outcomeKind,
        units,
        source: costs.source,
        ...(reason ? { reason } : {}),
      };
    });

    return {
      schema: RUNTIME_BUDGET_RECEIPT_SCHEMA,
      schemaVersion: 1,
      meta: { ...meta, producedBy: "allocator" },
      unit: costs.unit,
      enforcement: "descriptive",
      rows,
      actorTotals: Array.from(totalsByActor, ([actorId, units]) => ({ actorId, units })),
      unattributedUnits,
      totalUnits,
    };
  }

  /**
   * #279: a level's pricing, reported for a play session. A level `ak create` makes carries
   * the Allocator's receipt; one without it was never priced. Reported, not refused: a
   * hand-written level is played as written.
   */
  function reportLevelPricing(simConfig) {
    if (simConfig?.budgetReceiptRef?.id) return [];
    return [{
      code: "level_unpriced",
      message: "This level has no budget receipt, so it was not priced by the Allocator; build it with ak create to price it.",
    }];
  }

  /**
   * #277: whether a caller-supplied receipt can stand for spend. The Allocator judges its own
   * receipts; the sandbox used to check them in glue, differently in the CLI and the MCP.
   * Only an approved receipt with a non-negative remainder and its line items is usable.
   */
  function assessReceiptForUse(receipt) {
    const refuse = (error, budgetInsufficient = false) => ({ ok: false, error, ...(budgetInsufficient ? { budgetInsufficient } : {}) });
    if (receipt?.schema !== BUDGET_RECEIPT_ARTIFACT_SCHEMA) {
      return refuse(`Expected ${BUDGET_RECEIPT_ARTIFACT_SCHEMA}, got ${receipt?.schema || "unknown"}`);
    }
    if (receipt.schemaVersion !== 1) return refuse(`Budget receipt schemaVersion must be 1, got ${receipt.schemaVersion}`);
    if (typeof receipt.meta?.id !== "string" || !receipt.meta.id.trim()) return refuse("Budget receipt is missing meta.id");
    if (receipt.status !== "approved") {
      return refuse(`Budget receipt status must be "approved", got ${JSON.stringify(receipt.status)}`, true);
    }
    if (!(Number.isFinite(receipt.remaining) && receipt.remaining >= 0)) {
      return refuse(`Budget receipt remaining must be a non-negative finite number, got ${receipt.remaining}`, true);
    }
    if (!Array.isArray(receipt.lineItems)) return refuse("Budget receipt is missing lineItems array");
    return { ok: true };
  }

  /**
   * #278: `ak run` overrides change a level after it was priced. The changed level is priced
   * again, against the budget of the level's own receipt when there is one (its total cost
   * plus what remained) and the reference budget otherwise, and a new receipt is issued.
   * Reported, not refused: a level the overrides take over budget still runs.
   */
  function priceLevelOverrides({ simConfig, initialState, levelReceipt, priceList, budgetMeta, proposalMeta, receiptMeta, normalizeMotivations } = {}) {
    const levelBudget = Number.isFinite(levelReceipt?.totalCost) && Number.isFinite(levelReceipt?.remaining)
      ? levelReceipt.totalCost + levelReceipt.remaining
      : REFERENCE_BUDGET_TOKENS;
    const resolvedPriceList = resolvePriceList(priceList);
    const { receipt } = evaluateConfiguratorSpend({
      budget: { schema: BUDGET_ARTIFACT_SCHEMA, schemaVersion: 1, meta: budgetMeta, budget: { tokens: levelBudget } },
      priceList: resolvedPriceList,
      layout: simConfig?.layout?.data,
      actors: Array.isArray(initialState?.actors) ? initialState.actors : [],
      proposalMeta,
      receiptMeta,
      normalizeMotivations,
    });
    const report = receipt.status === "approved" ? [] : [{
      code: "overrides_over_budget",
      message: `The overrides cost ${receipt.totalCost} of the level's ${levelBudget}-token budget; the run plays as overridden.`,
    }];
    return { receipt, priceList: resolvedPriceList, report };
  }

  /**
   * Core prices a cast only as base × s(s+1)/2 (#232). An artifact written before that
   * carried five-tier `castMana` tables; its tier-1 price is the curve's base, so it loads
   * on the one curve rather than keeping a second price model alive. Price translation is
   * the Allocator's (#279), so the run loader asks for it here.
   */
  function castPricesFromLegacyTiers(costs) {
    const isPlain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
    if (!isPlain(costs) || !isPlain(costs.castMana) || Object.hasOwn(costs, "castManaBase")) return costs;
    const { castMana, ...rest } = costs;
    const castManaBase = {};
    for (const [key, tiers] of Object.entries(castMana)) {
      castManaBase[key] = Array.isArray(tiers) ? tiers[0] : tiers;
    }
    return { ...rest, castManaBase };
  }

  /** Serializable service-side context merged into the persona view. */
  function serviceContext() {
    return {
      budgetTokens: registeredBudget?.budget?.tokens ?? null,
      receiptCount,
      lastReceiptStatus,
      // Absent, not null, until one happens: `reconciliation: null` in a replayed
      // view reads as "reconciled, found nothing", which is a claim this persona
      // has not made.
      ...(lastReconciliation ? { reconciliation: lastReconciliation } : {}),
    };
  }

  return {
    pricing,
    reportLevelPricing,
    assessReceiptForUse,
    priceLevelOverrides,
    castPricesFromLegacyTiers,
    issueRuntimeBudgetReceipt,
    resolvePriceList,
    resolveActorExpansionAvailability,
    wardenShareApproved,
    delverShareApproved,
    hazardShareApproved,
    priceMixedRoomDesignSpend: boundPriceMixedRoomDesignSpend,
    registerBudget,
    validateSpend,
    evaluateLayoutSpend: boundEvaluateLayoutSpend,
    evaluateRoomCardLayoutSpend: boundEvaluateRoomCardLayoutSpend,
    scenarioSpendReport,
    assessFeasibility,
    maximizeFulfillment,
    // CR.4 M5b.2b — published so the Orchestrator's budget loop can ASK for these
    // rather than importing budget-allocation.js / selection-spend.js / layout-spend.js.
    resolveTileCosts,
    allocateBudget,
    evaluateSelectionSpend: boundEvaluateSelectionSpend,
    prepareLayoutBudgetFit,
    completeLayoutBudgetFit,
    fitLayoutToBudget: boundFitLayoutToBudget,
    // #300 — the tile counts a built level was billed for, so `ak solve --question
    // budget-fit` asks about the same tiles the receipt charged.
    billedLayoutTiles,
    // P5.5 — the chartered reconciliation. State-gated, unlike the pricing surface.
    reconcile,
    serviceContext,
  };
}
