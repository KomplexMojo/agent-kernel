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

export function createHostedLayoutBudgetFitter({
  prepare,
  complete,
  adapter,
  clock = UNUSED_CLOCK,
} = {}) {
  if (typeof prepare !== "function" || typeof complete !== "function") {
    throw new Error("Hosted layout budget fit requires prepare and complete persona capabilities.");
  }

  return async function fitLayout(args = {}) {
    const prepared = prepare(args);
    if (prepared?.status !== "ready") return complete({ ...args, prepared });

    if (!adapterHandlesDomain(adapter, CONSTRAINT_DOMAINS.ALLOCATOR_BUDGET_FIT)) {
      return complete({
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
    return complete({ ...args, prepared, solverResult });
  };
}

/** Host the Configurator's object-placement effect without passing an adapter into the persona. */
export function createHostedObjectPlacer({
  prepare,
  complete,
  adapter,
  clock = UNUSED_CLOCK,
} = {}) {
  if (typeof prepare !== "function" || typeof complete !== "function") {
    throw new Error("Hosted object placement requires prepare and complete persona capabilities.");
  }

  return async function placeObjects(args = {}) {
    const prepared = prepare(args);
    const handlesDomain = adapterHandlesDomain(adapter, CONSTRAINT_DOMAINS.CONFIGURATOR_SATISFIABILITY);
    if (prepared?.status === "unsat" && handlesDomain) {
      return complete({
        ...args,
        prepared,
        solverResult: { status: "unsat", reason: prepared.reason },
      });
    }
    if (prepared?.status !== "ready") return complete({ ...args, prepared });

    if (!handlesDomain) {
      return complete({
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
    return complete({ ...args, prepared, solverResult });
  };
}
