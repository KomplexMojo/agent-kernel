/**
 * Host-side solver round trips for build-plane persona capabilities.
 *
 * A persona authors an effect as data. This glue checks routing capability, dispatches
 * through the established effect boundary, awaits the solver port, and hands the normalized
 * result back to the persona consumer. No adapter object crosses into a persona.
 */
import { CONSTRAINT_DOMAINS } from "../contracts/constraint-problem.js";
import { dispatchEffect } from "../ports/effects.js";
import { adapterHandlesDomain } from "../ports/solver-conformance.js";
import { createSolverPort } from "../ports/solver.js";
import { UNUSED_CLOCK } from "../personas/_shared/require-clock.js";

const DECISION_LABELS = Object.freeze({
  [CONSTRAINT_DOMAINS.CONFIGURATOR_SATISFIABILITY]: "placement",
  [CONSTRAINT_DOMAINS.ALLOCATOR_BUDGET_FIT]: "budget fit",
});

/**
 * #299 — what decided one build-time question, as the host saw it: the solver's answer was
 * consumed (`solver`), the persona's characterized fallback answered (`fallback`, with the
 * solver status and reason that sent it there, e.g. `deferred`/`solver_domain_unavailable`),
 * or no search was posed at all (`none`). Glue records it; the persona decides nothing new.
 */
export function describeSolverDecision({ domain, prepared, solverResult, outcome } = {}) {
  const record = { domain };
  if (prepared?.status === "error" || prepared?.status === "bypass") {
    record.decision = "none";
    record.status = prepared.status;
    record.reason = prepared.status === "bypass" ? "no_search_needed" : prepared.reason;
  } else if (!solverResult) {
    record.decision = "fallback";
    record.status = prepared?.status || "not_posed";
    if (prepared?.reason) record.reason = prepared.reason;
  } else if (solverResult.status === "deferred" || solverResult.status === "error") {
    record.decision = "fallback";
    record.status = solverResult.status;
    record.reason = solverResult.reason || "solver_unavailable";
  } else {
    record.decision = "solver";
    record.status = solverResult.status;
    if (outcome?.ok === false && outcome.reason) record.reason = outcome.reason;
    const objectiveValues = solverResult.model?.objectiveValues;
    if (Array.isArray(objectiveValues)) record.objectiveValues = [...objectiveValues];
  }
  // #301: how each relational placement constraint came out.
  if (Array.isArray(outcome?.placementReport)) record.placementReport = outcome.placementReport;
  return record;
}

/** One line per build: "placement: fallback (solver_domain_unavailable); budget fit: solver". */
export function summarizeSolverDecisions(decisions = []) {
  if (!Array.isArray(decisions) || decisions.length === 0) return "";
  return decisions.map((entry) => {
    const label = DECISION_LABELS[entry?.domain] || entry?.domain || "unknown";
    const detail = entry?.decision === "solver"
      ? (entry.reason ? ` (${entry.status}: ${entry.reason})` : "")
      : ` (${entry?.reason || entry?.status || "unknown"})`;
    return `${label}: ${entry?.decision || "unknown"}${detail}`;
  }).join("; ");
}

function recorded(record, domain, args, outcome) {
  if (typeof record === "function") {
    record(describeSolverDecision({ domain, prepared: args.prepared, solverResult: args.solverResult, outcome }));
  }
  return outcome;
}

export function createHostedLayoutBudgetFitter({
  prepare,
  complete,
  adapter,
  clock = UNUSED_CLOCK,
  record,
} = {}) {
  if (typeof prepare !== "function" || typeof complete !== "function") {
    throw new Error("Hosted layout budget fit requires prepare and complete persona capabilities.");
  }
  const domain = CONSTRAINT_DOMAINS.ALLOCATOR_BUDGET_FIT;
  const finish = (input) => recorded(record, domain, input, complete(input));

  return async function fitLayout(args = {}) {
    const prepared = prepare(args);
    if (prepared?.status !== "ready") return finish({ ...args, prepared });

    if (!adapterHandlesDomain(adapter, domain)) {
      return finish({
        ...args,
        prepared,
        solverResult: { status: "deferred", reason: "solver_domain_unavailable" },
      });
    }

    const port = createSolverPort({ clock });
    const dispatched = dispatchEffect({
      solver: {
        solve: (effect) => port.solve(adapter, effect.request || effect),
      },
    }, prepared.effect);
    const solverResult = dispatched.status === "fulfilled"
      ? await dispatched.result
      : { status: dispatched.status, reason: dispatched.reason };
    return finish({ ...args, prepared, solverResult });
  };
}

/** Host the Configurator's object-placement effect without passing an adapter into the persona. */
export function createHostedObjectPlacer({
  prepare,
  complete,
  adapter,
  clock = UNUSED_CLOCK,
  record,
} = {}) {
  if (typeof prepare !== "function" || typeof complete !== "function") {
    throw new Error("Hosted object placement requires prepare and complete persona capabilities.");
  }
  const domain = CONSTRAINT_DOMAINS.CONFIGURATOR_SATISFIABILITY;
  const finish = (input) => recorded(record, domain, input, complete(input));

  return async function placeObjects(args = {}) {
    const prepared = prepare(args);
    const handlesDomain = adapterHandlesDomain(adapter, domain);
    if (prepared?.status === "unsat" && handlesDomain) {
      return finish({
        ...args,
        prepared,
        solverResult: { status: "unsat", reason: prepared.reason },
      });
    }
    if (prepared?.status !== "ready") return finish({ ...args, prepared });

    if (!handlesDomain) {
      return finish({
        ...args,
        prepared,
        solverResult: { status: "deferred", reason: "solver_domain_unavailable" },
      });
    }

    const port = createSolverPort({ clock });
    const dispatched = dispatchEffect({
      solver: { solve: (effect) => port.solve(adapter, effect.request || effect) },
    }, prepared.effect);
    const solverResult = dispatched.status === "fulfilled"
      ? await dispatched.result
      : { status: dispatched.status, reason: dispatched.reason };
    return finish({ ...args, prepared, solverResult });
  };
}
