/**
 * Deterministic fixture adapter for Actor-authored lexicographic objectives.
 *
 * This test double preserves forced status/error controls while sharing the
 * production contract: validate opaque integer tuples, sort them stably, and
 * never derive gameplay meaning from actions or observations.
 */

const RUNTIME_DECISION_CONTRACT = "runtime-decision-v1";
const ACTOR_DECISION_OBJECTIVE_CONTRACTS = new Set([
  "actor-decision-objective-v1",
  "actor-decision-objective-v2",
  "actor-decision-objective-v3",
  "actor-decision-objective-v4",
]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateEnvelope(envelope) {
  if (!envelope || envelope.contract !== RUNTIME_DECISION_CONTRACT) {
    return "z3_missing_runtime_decision_envelope";
  }
  if (!Array.isArray(envelope.candidateActions)) return "z3_missing_candidate_actions";
  if (envelope.candidateActions.some((candidate) => (
    !candidate
    || typeof candidate.id !== "string"
    || candidate.id.length === 0
    || !isObject(candidate.action)
  ))) {
    return "z3_invalid_candidate_action";
  }
  return null;
}

function readObjectiveRows(envelope) {
  const objective = envelope.objectives?.actorDecision;
  if (objective === undefined) {
    return { ok: false, reason: "actor_decision_objective_missing" };
  }
  if (!isObject(objective) || !ACTOR_DECISION_OBJECTIVE_CONTRACTS.has(objective.contract)
    || !Array.isArray(objective.order) || objective.order.length === 0
    || objective.order.some((entry) => typeof entry !== "string" || entry.trim().length === 0)
    || new Set(objective.order).size !== objective.order.length) {
    return { ok: false, reason: "actor_decision_objective_invalid" };
  }
  const candidates = envelope.candidateActions;
  if (!Array.isArray(objective.candidates) || objective.candidates.length !== candidates.length) {
    return { ok: false, reason: "actor_decision_objective_invalid" };
  }
  const candidateIds = candidates.map((candidate) => candidate.id);
  if (new Set(candidateIds).size !== candidateIds.length) {
    return { ok: false, reason: "actor_decision_objective_invalid" };
  }
  for (let index = 0; index < objective.candidates.length; index += 1) {
    const row = objective.candidates[index];
    if (!isObject(row) || row.candidateActionId !== candidateIds[index]
      || !Array.isArray(row.rank) || row.rank.length !== objective.order.length
      || row.rank.some((member) => !Number.isInteger(member))
      || !isObject(row.features) || !Array.isArray(row.rationaleTags)
      || row.rationaleTags.some((tag) => typeof tag !== "string" || tag.trim().length === 0)) {
      return { ok: false, reason: "actor_decision_objective_invalid" };
    }
  }
  try {
    return {
      ok: true,
      rows: objective.candidates.map((row, index) => ({
        index,
        candidateActionId: row.candidateActionId,
        rank: [...row.rank],
        features: JSON.parse(JSON.stringify(row.features)),
        rationaleTags: [...row.rationaleTags],
      })),
    };
  } catch {
    return { ok: false, reason: "actor_decision_objective_invalid" };
  }
}

function compareRows(left, right) {
  for (let index = 0; index < left.rank.length; index += 1) {
    if (left.rank[index] > right.rank[index]) return -1;
    if (left.rank[index] < right.rank[index]) return 1;
  }
  return left.index - right.index;
}

export function createZ3SolverAdapter(options = {}) {
  const { forceStatus = null, throwOnSolve = false } = options;

  async function solve(request) {
    if (throwOnSolve) throw new Error("z3_adapter_simulated_failure");
    if (forceStatus === "deferred") return { status: "deferred", reason: "z3_forced_deferred" };
    if (forceStatus === "unsat") return { status: "unsat", reason: "z3_no_satisfying_assignment" };
    if (forceStatus === "error") return { status: "error", reason: "z3_forced_error" };

    const envelope = request?.problem?.data;
    const validationError = validateEnvelope(envelope);
    if (validationError) return { status: "error", reason: validationError };
    if (envelope.candidateActions.length === 0) {
      return { status: "unsat", reason: "z3_no_candidates" };
    }
    const objectiveRows = readObjectiveRows(envelope);
    if (!objectiveRows.ok) return { status: "deferred", reason: objectiveRows.reason };
    const ranked = objectiveRows.rows.slice().sort(compareRows);
    const winner = ranked[0];
    return {
      status: "fulfilled",
      model: {
        contract: RUNTIME_DECISION_CONTRACT,
        decisionKind: envelope.decisionKind || "next_move",
        selectedActionId: winner.candidateActionId,
        rationaleTags: [...winner.rationaleTags],
        rankedCandidates: ranked.map(({ index: _index, ...row }) => row),
      },
    };
  }

  return {
    solve,
    kind: "z3",
    capabilities: {
      domains: ["actor_action_selection"],
      deterministic: true,
    },
  };
}
