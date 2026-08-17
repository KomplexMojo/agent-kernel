/**
 * Z.2 — the Configurator poses its own question: is this configuration
 * satisfiable, and if not, which requirement is the one that fails?
 *
 * The satisfiability layer inside `affinity-rules.js` and `candidate-authoring.js`
 * is small today, and this milestone does not pretend otherwise. What makes it
 * worth a domain is the SECOND half of the question. The rules this repo has
 * accumulated are exactly the kind that fail quietly:
 *
 *   - a mobility motivation requires a stamina POOL, not merely regen (F12 — the
 *     rule was enforced on the wrong half of the vital for as long as it existed)
 *   - an affinity requires mana to express (F14 — the same defect one vital over)
 *   - motivations in one exclusive group contradict each other (F9 — core could
 *     answer this and nothing asked)
 *
 * Every one of those was a requirement that existed, passed, and guaranteed
 * nothing. A solver that reports WHICH constraint is unsatisfiable turns "this
 * config is invalid" into "this actor cannot move because its stamina pool is
 * 0" — and the second sentence is the one that would have saved the session.
 *
 * The NORMALIZATION half of those modules is deliberately not modelled here.
 * Shape checking is not a constraint problem, and forcing it through one makes
 * it slower and less legible for nothing.
 */
import {
  CONSTRAINT_DOMAINS,
  buildConstraintProblem,
  CONSTRAINT_RESULT_STATUS,
} from "../../contracts/constraint-problem.js";

const POSED_BY = "configurator";

/**
 * @param {object} args
 * @param {Array} args.actors   configured actors, each with motivations, vitals
 *   and affinities as authored
 * @param {object} args.meta
 */
export function buildSatisfiabilityProblem({ actors = [], meta } = {}) {
  const variables = [];
  const constraints = [];

  actors.forEach((actor, index) => {
    const id = typeof actor?.id === "string" && actor.id.trim() ? actor.id.trim() : `actor_${index}`;
    const motivations = [];
    if (typeof actor?.motivation?.kind === "string") motivations.push(actor.motivation.kind);
    if (Array.isArray(actor?.motivations)) {
      actor.motivations.forEach((entry) => {
        const kind = typeof entry === "string" ? entry : entry?.kind;
        if (typeof kind === "string" && kind.trim()) motivations.push(kind.trim());
      });
    }

    variables.push({
      id,
      motivations,
      vitals: actor?.vitals ?? null,
      affinities: Array.isArray(actor?.affinities) ? actor.affinities : [],
    });

    // Stated per actor rather than once globally, so an `unsat` names WHICH
    // actor fails. "The configuration is unsatisfiable" is not actionable; "this
    // actor's stamina pool is 0 and its motivation implies movement" is.
    if (motivations.length > 1) {
      constraints.push({ id: `${id}:motivation_exclusivity`, type: "mutual_exclusion", subject: id, kinds: motivations });
    }
    if (motivations.length > 0) {
      constraints.push({ id: `${id}:mobility_requires_stamina`, type: "implication", subject: id, requires: "stamina.max" });
    }
    if (Array.isArray(actor?.affinities) && actor.affinities.length > 0) {
      constraints.push({ id: `${id}:affinity_requires_mana`, type: "implication", subject: id, requires: "mana.max" });
    }
  });

  return buildConstraintProblem({
    domain: CONSTRAINT_DOMAINS.CONFIGURATOR_SATISFIABILITY,
    posedBy: POSED_BY,
    meta,
    variables,
    constraints,
    objective: { id: "satisfiable", sense: "decide" },
    context: { actorCount: variables.length },
  });
}

/**
 * Consume a normalized result into `{ satisfiable, failing }`.
 *
 * An `unsat` WITHOUT a named constraint returns `failing: []` and is worth
 * noticing rather than smoothing over: it is the solver giving back less than
 * the imperative check it replaced, which already knew which rule it tripped.
 */
export function resolveSatisfiabilityFromConstraintResult(result) {
  if (!result) return null;
  if (result.status === CONSTRAINT_RESULT_STATUS.FULFILLED) {
    return { satisfiable: true, failing: [] };
  }
  if (result.status === CONSTRAINT_RESULT_STATUS.UNSAT) {
    const named = result?.model?.unsatisfiedConstraints;
    return {
      satisfiable: false,
      failing: Array.isArray(named) ? named.slice() : [],
      reason: result.reason,
    };
  }
  // deferred / error: the Configurator's own imperative checks stand. A solver
  // that could not answer must not read as "valid".
  return null;
}
