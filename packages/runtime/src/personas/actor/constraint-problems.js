/**
 * Z.2 — the Actor poses its own question: which action should this actor take?
 *
 * This is the highest-value adoption of the three, and the reason is specific:
 * `controller.js` is 1115 lines and 136 branches of name-keyed cascade, and
 * AM.6 and AM.9 just multiplied it — casts × targets × range × mana × flag mask
 * × reserved tiles. That is a search wearing the clothes of a decision tree.
 *
 * WHAT THIS DOES NOT DO. It does not replace the rule path. The Actor still
 * produces its proposals deterministically; this expresses the SAME choice as a
 * constraint problem so a solver can be asked for a better one. When the solver
 * defers, errors, or finds nothing, the rule path's answer stands unchanged —
 * that fallback is not a nicety, it is what keeps a solver from becoming a
 * single point of failure in a tick.
 *
 * Ownership: the Actor poses `actor_action_selection` and nobody else may
 * (`validateConstraintProblem` enforces it). The Actor does not pose budget or
 * validity questions — those are the Allocator's and the Configurator's.
 */
import {
  CONSTRAINT_DOMAINS,
  buildConstraintProblem,
  CONSTRAINT_RESULT_STATUS,
} from "../../contracts/constraint-problem.js";

const POSED_BY = "actor";

function candidateId(proposal, index) {
  if (typeof proposal?.candidateId === "string" && proposal.candidateId.trim()) {
    return proposal.candidateId.trim();
  }
  return `candidate_${index + 1}`;
}

/**
 * Turn the Actor's own proposals into a constraint problem.
 *
 * `variables` are the candidate actions — the only things the solver may choose
 * between. Giving it a space the Actor did not author would let it invent an
 * action the rule path never validated, which is how a solver produces a
 * confidently illegal move.
 *
 * `constraints` are the legality facts the Actor already knows: what it can
 * afford and where it may not go. They are stated rather than implied so an
 * `unsat` can name the binding one.
 *
 * @param {object} args
 * @param {object} args.actor        the acting actor (id, position)
 * @param {Array}  args.proposals    the rule path's own candidates
 * @param {object} [args.resources]  { mana, stamina } currently available
 * @param {Array}  [args.reservedTargets] tiles already claimed this tick
 * @param {object} args.meta         ArtifactMeta from the caller
 * @param {number} [args.tick]
 */
export function buildActionSelectionProblem({
  actor,
  proposals = [],
  resources = {},
  reservedTargets = [],
  meta,
  tick = 0,
} = {}) {
  const variables = proposals.map((proposal, index) => ({
    id: candidateId(proposal, index),
    kind: proposal?.kind,
    params: proposal?.params ?? {},
  }));

  const constraints = [];
  if (Number.isFinite(resources.mana)) {
    constraints.push({ id: "mana_available", type: "resource", vital: "mana", available: resources.mana });
  }
  if (Number.isFinite(resources.stamina)) {
    constraints.push({ id: "stamina_available", type: "resource", vital: "stamina", available: resources.stamina });
  }
  if (Array.isArray(reservedTargets) && reservedTargets.length > 0) {
    // Tiles claimed by actors that decided earlier in this same tick. Core does
    // not know about them yet — occupancy updates at APPLY — so a solver that
    // did not see them would happily route two actors onto one tile.
    constraints.push({
      id: "reserved_tiles",
      type: "exclusion",
      tiles: reservedTargets.map(({ x, y }) => ({ x, y })),
    });
  }

  return buildConstraintProblem({
    domain: CONSTRAINT_DOMAINS.ACTOR_ACTION_SELECTION,
    posedBy: POSED_BY,
    meta,
    variables,
    constraints,
    objective: { id: "select_one_action", sense: "choose", cardinality: 1 },
    context: {
      tick,
      actorId: actor?.id ?? null,
      position: actor?.position ?? null,
    },
  });
}

/**
 * Consume a normalized result and return the chosen proposal, or `null`.
 *
 * `null` is the honest answer for every non-fulfilled status AND for a model
 * naming a candidate that was not offered. The caller keeps its own answer in
 * that case; a solver that names something the Actor never proposed is not
 * partially right, it is answering a different question.
 */
export function resolveActionFromConstraintResult(result, proposals = []) {
  if (result?.status !== CONSTRAINT_RESULT_STATUS.FULFILLED) return null;
  const selected = result?.model?.selectedActionId;
  if (typeof selected !== "string" || !selected.trim()) return null;
  const index = proposals.findIndex((proposal, i) => candidateId(proposal, i) === selected.trim());
  return index >= 0 ? proposals[index] : null;
}
