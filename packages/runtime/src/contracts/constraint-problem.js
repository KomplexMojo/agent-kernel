/**
 * Z.1 — the constraint-problem contract family.
 *
 * WHAT THIS IS FOR, AND WHAT IT DELIBERATELY IS NOT
 *
 * The maintainer's rule for solver adoption (2026-08-14): *"I don't want it
 * artificially introduced where it will provide no value. The goal is to use a
 * solver instead of extensive rule cages."* So this contract exists for the
 * the closed set of adopted constraint domains. Domain adoption does not imply
 * that every question in that persona belongs in a solver:
 *
 *   actor_action_selection      1115 lines / 136 branches, and AM.6 + AM.9 just
 *                               added casts x targets x range x mana to it
 *   allocator_budget_fit        `pickCheapestField` / `selectReductionField` are
 *                               a hand-rolled knapsack approximation
 *   configurator_satisfiability object-placement assignment (Z9); actor configuration
 *                               validity is bounded deterministic validation (Z8.0)
 *
 * Four sites were REFUSED and must not acquire a separate domain here: Configurator
 * motivation/affinity/vital validity, plus the Moderator's
 * affinity interaction resolution and tick ordering are total functions over
 * bounded inputs (pair/threshold checks, a 48-cell lookup, and a sort — already
 * complete), and the core affinity/vital matrices are evaluations, not searches.
 * Adding a domain for any of them would be the artificial introduction the rule
 * forbids. Z9 uses the existing Configurator domain with
 * `context.problemKind: "object_placement"`; live resource-grant slots remain core
 * runtime state and are not Configurator variables.
 *
 * The solver PORT (`ports/solver.js`) and effect routing (`ports/effects.js`)
 * are already correct and are untouched by this. What was missing is a problem
 * shape general enough for three domains: `runtime-decision-v1` was a one-off
 * understood only by the Actor path and the stand-in adapter.
 */

// The schema strings live in artifacts.ts, the single declaration origin, and are
// re-exported here so callers of this module need only one import. Writing the
// literals here instead would have created exactly the second origin the
// schema-declaration guard exists to forbid — which it duly caught.
import {
  CONSTRAINT_PROBLEM_SCHEMA,
  CONSTRAINT_RESULT_SCHEMA,
} from "./artifacts.ts";

export { CONSTRAINT_PROBLEM_SCHEMA, CONSTRAINT_RESULT_SCHEMA };
export const CONSTRAINT_PROBLEM_SCHEMA_VERSION = 1;

/**
 * The domains a solver may be asked about. Closed on purpose: adding a member is
 * a decision about where search beats evaluation, and it should be argued in a
 * milestone rather than appear as a string.
 */
export const CONSTRAINT_DOMAINS = Object.freeze({
  /** Which action should this actor take? Chartered §385; the Actor owns it. */
  ACTOR_ACTION_SELECTION: "actor_action_selection",
  /** Which purchases fit the budget best? The Allocator owns it, and prices it. */
  ALLOCATOR_BUDGET_FIT: "allocator_budget_fit",
  /** Configurator-owned searches, currently reserved for Z9 object placement. */
  CONFIGURATOR_SATISFIABILITY: "configurator_satisfiability",
});

const DOMAIN_VALUES = Object.freeze(Object.values(CONSTRAINT_DOMAINS));

/**
 * The persona that OWNS each domain. A problem posed by anyone else is a
 * persona-boundary violation, not a routing detail: the Allocator may not pose a
 * configuration-validity question, and the Configurator may not pose a pricing
 * one. Enforced by `validateConstraintProblem`.
 */
export const CONSTRAINT_DOMAIN_OWNERS = Object.freeze({
  [CONSTRAINT_DOMAINS.ACTOR_ACTION_SELECTION]: "actor",
  [CONSTRAINT_DOMAINS.ALLOCATOR_BUDGET_FIT]: "allocator",
  [CONSTRAINT_DOMAINS.CONFIGURATOR_SATISFIABILITY]: "configurator",
});

/**
 * `runtime-decision-v1` is the family's FIRST MEMBER, not a parallel scheme.
 * The Actor's existing envelope keeps this contract string so nothing that reads
 * it today has to change; new domains use the family schema.
 */
export const RUNTIME_DECISION_CONTRACT = "runtime-decision-v1";

export const CONSTRAINT_RESULT_STATUS = Object.freeze({
  FULFILLED: "fulfilled",
  UNSAT: "unsat",
  DEFERRED: "deferred",
  ERROR: "error",
});

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function isConstraintDomain(domain) {
  return DOMAIN_VALUES.includes(domain);
}

/**
 * Build a constraint problem. `variables`, `constraints` and `objective` are
 * deliberately opaque to this module: what they MEAN belongs to the owning
 * persona, and giving this module an opinion about them would move domain logic
 * into a contract.
 */
export function buildConstraintProblem({
  domain,
  posedBy,
  meta,
  variables = [],
  constraints = [],
  objective = null,
  context = {},
} = {}) {
  return {
    schema: CONSTRAINT_PROBLEM_SCHEMA,
    schemaVersion: CONSTRAINT_PROBLEM_SCHEMA_VERSION,
    meta,
    domain,
    posedBy,
    variables,
    constraints,
    objective,
    context,
  };
}

/**
 * Structural validity plus the ownership rule. Returns `{ ok, errors }` rather
 * than throwing, so a caller can report every problem at once.
 */
export function validateConstraintProblem(problem) {
  const errors = [];
  if (!isObject(problem)) {
    return { ok: false, errors: ["problem: expected object"] };
  }
  if (problem.schema !== CONSTRAINT_PROBLEM_SCHEMA) {
    errors.push(`schema: expected ${CONSTRAINT_PROBLEM_SCHEMA}`);
  }
  if (problem.schemaVersion !== CONSTRAINT_PROBLEM_SCHEMA_VERSION) {
    errors.push(`schemaVersion: expected ${CONSTRAINT_PROBLEM_SCHEMA_VERSION}`);
  }
  if (!isConstraintDomain(problem.domain)) {
    errors.push(
      `domain: "${problem.domain}" is not an adopted constraint domain. `
      + `Adopted: ${DOMAIN_VALUES.join(", ")}. A site that EVALUATES rather than `
      + "SEARCHES does not get a domain — see this module's header.",
    );
  } else {
    const owner = CONSTRAINT_DOMAIN_OWNERS[problem.domain];
    if (isNonEmptyString(problem.posedBy) && problem.posedBy !== owner) {
      errors.push(
        `posedBy: "${problem.domain}" is owned by the ${owner}, but was posed by `
        + `"${problem.posedBy}". One persona may not pose another's question.`,
      );
    }
    if (!isNonEmptyString(problem.posedBy)) {
      errors.push("posedBy: required — an unattributed problem has no owner to answer to");
    }
  }
  if (!Array.isArray(problem.variables)) errors.push("variables: expected array");
  if (!Array.isArray(problem.constraints)) errors.push("constraints: expected array");
  return { ok: errors.length === 0, errors };
}

/**
 * Normalize whatever an adapter returned into the one result shape personas
 * consume. An adapter that answers in its own dialect is normalized here rather
 * than at each call site, which is what keeps solver-specific knowledge out of
 * `runtime`.
 */
export function normalizeConstraintResult(raw, { domain, meta } = {}) {
  const status = isObject(raw) && isNonEmptyString(raw.status)
    ? raw.status
    : CONSTRAINT_RESULT_STATUS.ERROR;
  const normalized = {
    schema: CONSTRAINT_RESULT_SCHEMA,
    schemaVersion: CONSTRAINT_PROBLEM_SCHEMA_VERSION,
    meta: (isObject(raw) && raw.meta) || meta,
    domain,
    status,
    model: (isObject(raw) && isObject(raw.model)) ? raw.model : null,
  };
  if (isObject(raw) && isNonEmptyString(raw.reason)) normalized.reason = raw.reason;
  // An `unsat` with no reason is a dead end nobody can act on. The whole point of
  // preferring a solver to a greedy loop is that it can say WHY nothing fits.
  if (status === CONSTRAINT_RESULT_STATUS.UNSAT && !normalized.reason) {
    normalized.reason = "unsat_without_explanation";
  }
  return normalized;
}
