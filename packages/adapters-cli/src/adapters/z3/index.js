/**
 * Hybrid deterministic constraint adapter.
 *
 * Candidate feature meaning and rank construction belong to the Actor.
 * Actor requests validate and sort opaque tuples without initializing Z3. Other adopted
 * search domains compile their persona-authored integer expressions generically. Deprecated
 * factories remain compatibility aliases for existing call sites.
 */

import { init } from "z3-solver";

const RUNTIME_DECISION_CONTRACT = "runtime-decision-v1";
const ACTOR_DECISION_OBJECTIVE_CONTRACTS = new Set([
  "actor-decision-objective-v1",
  "actor-decision-objective-v2",
  "actor-decision-objective-v3",
  "actor-decision-objective-v4",
]);
const ACTOR_DOMAIN = "actor_action_selection";
const ALLOCATOR_DOMAIN = "allocator_budget_fit";
const CONFIGURATOR_DOMAIN = "configurator_satisfiability";

/** See createGenericZ3Solver: reuse a context this many solves, then replace it. */
const MAX_SOLVES_PER_Z3_CONTEXT = 250;

let sharedZ3Promise;

function getSharedZ3() {
  sharedZ3Promise ||= init();
  return sharedZ3Promise;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateEnvelope(envelope) {
  // Preserve the established z3_* reason ids as wire compatibility for the
  // legacy engine alias; they do not mean this adapter initialized Z3.
  if (!envelope || envelope.contract !== RUNTIME_DECISION_CONTRACT) {
    return "z3_missing_runtime_decision_envelope";
  }
  if (!Array.isArray(envelope.candidateActions)) return "z3_missing_candidate_actions";
  if (envelope.candidateActions.some((candidate) => (
    !candidate
    || typeof candidate.id !== "string"
    || candidate.id.length === 0
    || !candidate.action
    || typeof candidate.action !== "object"
  ))) {
    return "z3_invalid_candidate_action";
  }
  return null;
}

function readActorDecisionRows(envelope) {
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
    if (!isObject(row) || row.candidateActionId !== candidateIds[index]) {
      return { ok: false, reason: "actor_decision_objective_invalid" };
    }
    if (!Array.isArray(row.rank)
      || row.rank.length !== objective.order.length
      || row.rank.some((member) => !Number.isInteger(member))) {
      return { ok: false, reason: "actor_decision_objective_invalid" };
    }
    if (!isObject(row.features)
      || !Array.isArray(row.rationaleTags)
      || row.rationaleTags.some((tag) => typeof tag !== "string" || tag.trim().length === 0)) {
      return { ok: false, reason: "actor_decision_objective_invalid" };
    }
  }
  try {
    return {
      ok: true,
      rows: objective.candidates.map((row, index) => ({
        candidate: candidates[index],
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

function compareObjectiveRows(left, right) {
  for (let index = 0; index < left.rank.length; index += 1) {
    if (left.rank[index] > right.rank[index]) return -1;
    if (left.rank[index] < right.rank[index]) return 1;
  }
  return left.index - right.index;
}

function solveActorObjective(envelope, rows) {
  const ranked = rows.slice().sort(compareObjectiveRows);
  const winner = ranked[0];
  return {
    status: "fulfilled",
    model: {
      contract: RUNTIME_DECISION_CONTRACT,
      decisionKind: envelope.decisionKind || "next_move",
      selectedActionId: winner.candidate.id,
      rationaleTags: [...winner.rationaleTags],
      rankedCandidates: ranked.map(({ candidate: _candidate, index: _index, ...row }) => row),
    },
  };
}

/** @deprecated Use createHybridConstraintSolverAdapter; retained for Actor-only callers. */
export function createActorLexicographicSolverAdapter() {
  async function solve(request) {
    try {
      const envelope = request?.problem?.data;
      const validationError = validateEnvelope(envelope);
      if (validationError) return { status: "error", reason: validationError };
      if (envelope.candidateActions.length === 0) {
        // Same compatibility reason as the former implementation.
        return { status: "unsat", reason: "z3_no_candidates" };
      }
      const objectiveRows = readActorDecisionRows(envelope);
      if (!objectiveRows.ok) return { status: "deferred", reason: objectiveRows.reason };
      return solveActorObjective(envelope, objectiveRows.rows);
    } catch (error) {
      return {
        status: "error",
        reason: "actor_decision_error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    solve,
    kind: "actor-lexicographic",
    capabilities: { domains: ["actor_action_selection"], deterministic: true },
  };
}

function requireInteger(value, label) {
  if (!Number.isInteger(value)) throw new Error(`${label}: expected integer`);
  return value;
}

function readGenericProblem(problem) {
  if (!isObject(problem) || !Array.isArray(problem.variables) || !Array.isArray(problem.constraints)) {
    throw new Error("constraint problem requires variables and constraints");
  }
  const variables = new Map();
  for (const variable of problem.variables) {
    if (!isObject(variable) || variable.kind !== "integer"
      || typeof variable.id !== "string" || variable.id.length === 0
      || variables.has(variable.id)) {
      throw new Error("constraint variables must be uniquely named integers");
    }
    requireInteger(variable.min, `${variable.id}.min`);
    requireInteger(variable.max, `${variable.id}.max`);
    if (variable.min > variable.max) throw new Error(`${variable.id}: minimum exceeds maximum`);
    variables.set(variable.id, variable);
  }
  if (!isObject(problem.objective) || problem.objective.kind !== "lexicographic"
    || !Array.isArray(problem.objective.priorities) || problem.objective.priorities.length === 0) {
    throw new Error("constraint objective must be a non-empty lexicographic list");
  }
  return { variables, constraints: problem.constraints, priorities: problem.objective.priorities };
}

function readTerms(expression, variables) {
  if (!Array.isArray(expression?.terms) || expression.terms.length === 0) {
    throw new Error("linear expression requires terms");
  }
  return expression.terms.map((term) => {
    if (!isObject(term) || !variables.has(term.variableId)) {
      throw new Error("linear term references an unknown variable");
    }
    return { variableId: term.variableId, coefficient: requireInteger(term.coefficient, "coefficient") };
  });
}

function buildCompiler(context, definitions) {
  const z3Variables = new Map(
    [...definitions.keys()].map((id) => [id, context.Int.const(id)]),
  );
  function linear(terms) {
    return terms.reduce(
      (sum, term) => sum.add(z3Variables.get(term.variableId).mul(term.coefficient)),
      context.Int.val(0),
    );
  }
  function expression(node) {
    if (!isObject(node)) throw new Error("objective expression must be an object");
    if (node.kind === "variable") {
      if (!definitions.has(node.variableId)) throw new Error("objective references an unknown variable");
      return z3Variables.get(node.variableId);
    }
    const value = linear(readTerms(node, definitions));
    if (node.kind === "linear") return value;
    if (node.kind === "absolute_linear") return context.If(value.ge(0), value, value.mul(-1));
    throw new Error(`unsupported expression kind: ${node.kind}`);
  }
  return { expression, linear, z3Variables };
}

function evaluateExpression(node, assignments) {
  if (node.kind === "variable") return assignments[node.variableId];
  const value = node.terms.reduce(
    (sum, term) => sum + assignments[term.variableId] * term.coefficient,
    0,
  );
  return node.kind === "absolute_linear" ? Math.abs(value) : value;
}

/**
 * A Z3 CONTEXT IS REUSED, AND RECYCLED ON A BOUND. Both halves are load-bearing,
 * because the two obvious policies each fail, in opposite directions.
 *
 * ONE CONTEXT PER SOLVE (what this did before) leaks. A `new Context(...)` is a WASM
 * allocation that is never reclaimed -- forcing a full GC does not recover it. Measured
 * through the Allocator path: 10.45 MB per solve, RSS 101 MB -> 2170 MB across 200
 * solves, linear and unbounded. Solve TIME stayed flat at ~8ms the whole way, which is
 * why this was never noticed: it fails by exhausting memory, not by slowing down, and
 * every test in the repo solves too few times to reach it. `runLlmBudgetLoop` calls the
 * hosted layout fitter from inside its round loop, so a long budget loop under
 * AK_SOLVER_ENGINE=z3-real grew without limit.
 *
 * ONE CONTEXT FOREVER also fails, just later and harder. A context's ast_manager
 * accumulates every expression node built against it, and past a few thousand solves the
 * WASM heap aborts with `memory access out of bounds` -- a process-killing crash, not a
 * status this adapter could return. Observed between 2000 and 2500 solves at the wider
 * of the two ledger profiles, while the narrower profile completed 2800.
 *
 * So the context is reused for a bounded run and then replaced. That amortizes the
 * unreclaimable per-context cost across MAX_SOLVES_PER_Z3_CONTEXT solves (~0.04 MB per
 * solve at the current bound) while keeping any single context far below the level where
 * accumulation becomes fatal. The bound is deliberately about 8x below the lowest
 * observed failure rather than tuned close to it: the failure mode is an abort that takes
 * the process with it, so the margin is worth more than the memory it costs.
 *
 * Reuse is CORRECT, not merely cheap: nothing solve-specific lives on the context. Each
 * solve builds its own `Optimize` and adds its own bounds, constraints and objectives to
 * that, and `Int.const(id)` returning the same AST node for the same id across solves is
 * exactly why sharing is sound -- the bounds that differ between problems live on the
 * Optimize, never on the variable. Verified over 1280 solves through the real persona and
 * host path: zero disagreements with an exhaustive oracle, zero differences between
 * forward and reverse solve order, and the first problem re-solved after 640 others
 * returning an identical model.
 *
 * This is precisely the property `checkSolverConformance` gates -- identical problem,
 * identical model -- so `tests/runtime/z3-real-adapter-conformance.test.js` and the
 * Allocator/Configurator replay assertions are what must stay green when this changes.
 */
function createGenericZ3Solver(getZ3) {
  let contextPromise;
  let solvesOnContext = 0;
  let contextSerial = 0;
  const getContext = () => {
    if (!contextPromise || solvesOnContext >= MAX_SOLVES_PER_Z3_CONTEXT) {
      contextSerial += 1;
      solvesOnContext = 0;
      const serial = contextSerial;
      contextPromise = getZ3().then(({ Context }) => new Context(`hybrid_constraint_${serial}`));
    }
    solvesOnContext += 1;
    return contextPromise;
  };
  return async function solveGeneric(problem) {
    try {
      const generic = readGenericProblem(problem);
      const context = await getContext();
      const compiler = buildCompiler(context, generic.variables);
      const optimizer = new context.Optimize();

      for (const [id, variable] of generic.variables) {
        const z3Variable = compiler.z3Variables.get(id);
        optimizer.add(z3Variable.ge(variable.min), z3Variable.le(variable.max));
      }
      for (const constraint of generic.constraints) {
        if (!isObject(constraint) || constraint.kind !== "linear") {
          throw new Error("only linear constraints are supported");
        }
        const left = compiler.linear(readTerms(constraint, generic.variables));
        const right = requireInteger(constraint.rightHandSide, "rightHandSide");
        if (constraint.relation === "<=") optimizer.add(left.le(right));
        else if (constraint.relation === ">=") optimizer.add(left.ge(right));
        else if (constraint.relation === "=") optimizer.add(left.eq(right));
        else throw new Error(`unsupported constraint relation: ${constraint.relation}`);
      }
      for (const priority of generic.priorities) {
        if (!isObject(priority) || !["maximize", "minimize"].includes(priority.sense)) {
          throw new Error("objective priority requires maximize or minimize");
        }
        const compiled = compiler.expression(priority.expression);
        if (priority.sense === "maximize") optimizer.maximize(compiled);
        else optimizer.minimize(compiled);
      }

      const status = await optimizer.check();
      if (status === "unsat") return { status: "unsat", reason: "constraint_unsatisfiable" };
      if (status !== "sat") {
        return { status: "error", reason: optimizer.reasonUnknown() || "constraint_optimize_unknown" };
      }
      const model = optimizer.model();
      const assignments = Object.fromEntries([...compiler.z3Variables].map(([id, variable]) => {
        const value = Number(model.eval(variable, true).toString());
        if (!Number.isSafeInteger(value)) throw new Error("model produced a non-integer assignment");
        return [id, value];
      }));
      return {
        status: "fulfilled",
        model: {
          assignments,
          objectiveValues: generic.priorities.map((priority) => (
            evaluateExpression(priority.expression, assignments)
          )),
        },
      };
    } catch (error) {
      return {
        status: "error",
        reason: "constraint_compile_error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  };
}

export function createHybridConstraintSolverAdapter(options = {}) {
  const actor = createActorLexicographicSolverAdapter();
  const getZ3 = typeof options.init === "function"
    ? (() => {
        let injectedZ3Promise;
        return () => {
          injectedZ3Promise ||= options.init();
          return injectedZ3Promise;
        };
      })()
    : getSharedZ3;
  const solveGeneric = createGenericZ3Solver(getZ3);

  async function solve(request) {
    const domain = request?.problem?.domain;
    if (domain === ALLOCATOR_DOMAIN || domain === CONFIGURATOR_DOMAIN) return solveGeneric(request.problem);
    if (domain === ACTOR_DOMAIN || request?.problem?.data?.contract === RUNTIME_DECISION_CONTRACT) {
      return actor.solve(request);
    }
    return { status: "deferred", reason: "constraint_domain_unsupported" };
  }

  return {
    solve,
    kind: "hybrid-constraint",
    capabilities: { domains: [ACTOR_DOMAIN, ALLOCATOR_DOMAIN, CONFIGURATOR_DOMAIN], deterministic: true },
  };
}

/** @deprecated Compatibility alias for AK_SOLVER_ENGINE=z3-real call sites. */
export function createRealZ3SolverAdapter(options = {}) {
  return createHybridConstraintSolverAdapter(options);
}
