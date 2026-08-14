/**
 * The CR.9 propose/judge protocol vocabulary — one origin, read by both personas.
 *
 * CR.9 M4. M3 split the fused maximizer across the persona line and minted three
 * artifacts for the exchange:
 *
 *   Allocator    -> Configurator   BudgetEnvelope         "spend up to this"
 *   Configurator -> Allocator      ConfigurationCandidate "here is a valid card"
 *   Allocator    -> Configurator   SpendVerdict           "approved at N / rejected because"
 *
 * It did not give that vocabulary a home. The schema strings were RESTATED at each
 * point of use (allocator/budget-fulfillment.js and configurator/candidate-authoring.js
 * each declared their own copies), and the refusal vocabulary was worse: the same four
 * authoring-validation outcomes were declared THREE times — `AGENT_COMMAND_VALIDATION_
 * OUTCOMES` in build-spec.js (the enforcing copy), `AgentCommandValidationOutcome` in
 * artifacts.ts (the type mirror), and a private `AUTHORING_VALIDATION_OUTCOMES` inside
 * the Allocator, which is not the persona that owns the vocabulary at all. Three
 * identical copies with nothing checking they agree is the CR.1 defect class — a
 * second silently-diverging answer to one question — sitting inside the milestone that
 * was supposed to end it.
 *
 * WHY A `.js` CONTRACTS MODULE AND NOT `artifacts.ts`. `artifacts.ts` is types-plus-
 * consts and there is no TS loader on the Node path, so no runtime `.js` module can
 * import it; that is exactly why the strings were restated. A runtime contracts module
 * CAN be imported by both personas, so the restatement stops being necessary. The
 * types in `artifacts.ts` remain the definitions of record for SHAPE; this file is the
 * definition of record for the VALUES, and `single-origin.test.js` fails if either
 * vocabulary is declared anywhere else under `packages/`.
 *
 * ═══ TWO VOCABULARIES, NOT ONE — a correction to the M4 plan row ═══════════════
 *
 * The plan row read "promote AUTHORING_VALIDATION_OUTCOMES into the published
 * SpendVerdict reason codes", which assumed the two sets merge. Reading the code says
 * they do not, and merging them would make both less honest:
 *
 *   SPEND_VERDICT_REJECT_REASONS   what judging ONE CANDIDATE can conclude.
 *                                  Produced by allocator/budget-fulfillment.js#judgeCandidate.
 *   AUTHORING_VALIDATION_OUTCOMES  what assessing a WHOLE REQUEST can conclude.
 *                                  Produced by #ensureBudgetedFulfillmentFeasible,
 *                                  validated on AgentCommandRequest by build-spec.js.
 *
 * They share the issue shape and the "refusal carries a structured reason" discipline,
 * and they are published together here — but a candidate is never "insufficient_budget"
 * (a request is), and a request is never "over_cap" (a candidate is). So
 * `SpendVerdictRejectReason` in artifacts.ts loses `invalid_requirements` and
 * `conflicting_requirements`, which nothing ever produced on a verdict and which were
 * authoring-validation values misfiled into the verdict union.
 *
 * EVERY VALUE BELOW HAS A PRODUCER OR SAYS WHY NOT. That is M4's real gate: the
 * milestone exists because this vocabulary was declared and never emitted, and a
 * closed set with an unreachable member is the same defect one level down.
 */

// ── Schemas ───────────────────────────────────────────────────────────────────

// M9: all three are declared in artifacts.ts and re-exported here under the names this
// module's importers already use. `import …; export { … }`, never `export { X } from "…"`
// — the latter re-exports without binding locally and throws at the first internal use.
import {
  BUDGET_ENVELOPE_SCHEMA,
  CONFIGURATION_CANDIDATE_SCHEMA,
  SPEND_VERDICT_SCHEMA,
} from "./artifacts.ts";

export { BUDGET_ENVELOPE_SCHEMA, CONFIGURATION_CANDIDATE_SCHEMA, SPEND_VERDICT_SCHEMA };

/**
 * Shared by all three, and deliberately one constant rather than three.
 *
 * The trio is a single protocol: a verdict answers a candidate, which was enumerated
 * against an envelope. Versioning one half without the others would describe an
 * exchange that never happens. When the protocol changes, this moves as a unit.
 */
export const SPEND_PROTOCOL_SCHEMA_VERSION = 1;

// ── Refusal vocabularies ──────────────────────────────────────────────────────

/**
 * Why the Allocator refused ONE candidate. Closed set; a verdict cannot carry an
 * unclassifiable refusal.
 *
 * Both are produced in `judgeCandidate` and both are reachable: `not_priceable` when
 * a candidate prices to a non-positive or non-integer cost, `over_cap` when it prices
 * above the envelope's per-unit cap. Before M4 they existed only as bare string
 * literals at the two `return` sites, so "which refusals can this system even issue?"
 * had no answer that could be read, imported or asserted.
 */
export const SPEND_VERDICT_REJECT_REASONS = Object.freeze({
  overCap: "over_cap",
  notPriceable: "not_priceable",
});

export const SPEND_VERDICT_REJECT_REASON_IDS = Object.freeze(
  Object.values(SPEND_VERDICT_REJECT_REASONS),
);

/**
 * Why a whole authoring request cannot be fulfilled. Closed set, validated on
 * `AgentCommandRequest.authoring.validation.outcome` by build-spec.js.
 *
 * Producers:
 *   valid                    - the absence of a refusal. Never constructed; build-spec
 *                              reads it to decide that `issues` may be empty.
 *   conflicting_requirements - allocator/budget-fulfillment.js, when a card's explicit
 *                              configuration contradicts what it needs to function.
 *   insufficient_budget      - allocator/budget-fulfillment.js, when the minimum spend
 *                              across all requested cards exceeds the hard budget.
 *   invalid_requirements     - NO PRODUCER IN THIS REPO. Retained deliberately: it is
 *                              an ACCEPTED INPUT value on an artifact this system also
 *                              reads, so narrowing the set would start rejecting
 *                              well-formed requests an external author may send. That
 *                              is a different thing from dead code, and the distinction
 *                              is the reason this comment exists rather than a deletion.
 */
export const AUTHORING_VALIDATION_OUTCOMES = Object.freeze({
  valid: "valid",
  invalidRequirements: "invalid_requirements",
  conflictingRequirements: "conflicting_requirements",
  insufficientBudget: "insufficient_budget",
});

export const AUTHORING_VALIDATION_OUTCOME_IDS = Object.freeze(
  Object.values(AUTHORING_VALIDATION_OUTCOMES),
);

// ── Shapes ────────────────────────────────────────────────────────────────────

/**
 * One blocking constraint, addressed to a field path the author can act on.
 *
 * `path` is omitted rather than emitted empty when absent — build-spec.js validates it
 * as an OPTIONAL string, and an empty one would fail that check.
 */
export function createAuthoringValidationIssue({ code, message, path } = {}) {
  const issue = {
    code,
    message,
  };
  if (path) {
    issue.path = path;
  }
  return issue;
}

/**
 * A structured refusal for a whole request: outcome, one-line summary, sorted issues.
 *
 * Lived in `allocator/budget-fulfillment.js` until M4, while the VALIDATOR for the
 * same shape lived in `contracts/build-spec.js` — builder and validator in different
 * layers, with nothing keeping them in step. Co-locating them is the point of the move:
 * a change to one is now made with the other in view.
 *
 * Issues are sorted by `path` then `code` so the refusal is byte-stable across runs
 * regardless of the order the checks happened to fire. Determinism is a contract here,
 * not a nicety — these strings reach goldens and CLI stderr.
 */
export function createAuthoringValidation({ outcome, summary, issues = [] } = {}) {
  return {
    outcome,
    summary,
    issues: issues
      .filter((issue) => issue && typeof issue === "object")
      .map((issue) => createAuthoringValidationIssue(issue))
      .sort((left, right) => {
        const leftPath = left.path || "";
        const rightPath = right.path || "";
        if (leftPath !== rightPath) {
          return leftPath.localeCompare(rightPath);
        }
        return left.code.localeCompare(right.code);
      }),
  };
}

/**
 * The Allocator approves one candidate at a price.
 *
 * `remainingTokens` is what makes revision a round trip rather than a field on the
 * candidate: the fill step spends the remainder, so the revised card is a function of
 * the PRICE, which the Configurator must not compute. See artifacts.ts SpendVerdictV1.
 */
export function approveSpend({ candidateId, unitCostTokens, costTokens, remainingTokens } = {}) {
  return {
    schema: SPEND_VERDICT_SCHEMA,
    schemaVersion: SPEND_PROTOCOL_SCHEMA_VERSION,
    candidateId,
    approved: true,
    unitCostTokens,
    costTokens,
    remainingTokens,
  };
}

/**
 * The Allocator refuses one candidate, with a reason from the closed set.
 *
 * Throwing on an unknown reason is the whole point of a closed set. A refusal that
 * carries a free-form string is a refusal nothing downstream can branch on, which is
 * the state M4 found: two literals at two return sites and no vocabulary anywhere.
 */
export function rejectSpend({ candidateId, reason } = {}) {
  if (!SPEND_VERDICT_REJECT_REASON_IDS.includes(reason)) {
    throw new Error(
      `Unknown SpendVerdict reject reason "${reason}". Reasons are a closed set: `
      + `${SPEND_VERDICT_REJECT_REASON_IDS.join(", ")} (contracts/spend-protocol.js).`,
    );
  }
  return {
    schema: SPEND_VERDICT_SCHEMA,
    schemaVersion: SPEND_PROTOCOL_SCHEMA_VERSION,
    candidateId,
    approved: false,
    reason,
  };
}
