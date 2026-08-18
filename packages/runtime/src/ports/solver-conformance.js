/**
 * Z.3 — what any solver adapter must satisfy before it is allowed near a run.
 *
 * Neither adapter in the repo today is Z3. `adapters-test/.../z3-adapter.js` is a
 * weighted-priority stand-in written in JS, and `adapters-cli/.../solver-z3` is a
 * fixture stub. That is fine — but it means nothing has ever had to state what a
 * REAL solver would have to guarantee, and the gap would be discovered during
 * the Z3 slice rather than before it.
 *
 * The gate is determinism, and it is not something Z3 provides for free. A
 * solver is free to return ANY satisfying assignment; which one it returns can
 * depend on variable ordering, internal heuristics, and — fatally — on a
 * wall-clock timeout. This repo replays runs and compares them frame by frame
 * (`ak replay` → `match: true`), so a solver that answers differently on the
 * second run breaks replay outright.
 *
 * Hence: identical problem → identical model. That is a constraint on how the
 * adapter is DRIVEN — fixed variable ordering, no wall-clock timeouts,
 * tie-breaks resolved before the solve — and this suite is where it is checked.
 */
import {
  CONSTRAINT_DOMAINS,
  CONSTRAINT_PROBLEM_SCHEMA,
  CONSTRAINT_RESULT_STATUS,
  isConstraintDomain,
} from "../contracts/constraint-problem.js";

/**
 * An adapter declares which domains it can answer. The port defers cleanly on
 * the rest instead of handing a domain to an adapter that will guess at it.
 *
 * Declared rather than inferred: an adapter that silently produced a
 * plausible-looking answer for a domain it does not model would be the worst
 * possible failure, because the answer would be acted on.
 */
export function describeSolverCapabilities(adapter) {
  const declared = Array.isArray(adapter?.capabilities?.domains)
    ? adapter.capabilities.domains.filter(isConstraintDomain)
    : [];
  return Object.freeze({
    kind: typeof adapter?.kind === "string" ? adapter.kind : "unknown",
    domains: Object.freeze(declared),
    /** Deterministic adapters may be used in a replayed run. Absent means NO. */
    deterministic: adapter?.capabilities?.deterministic === true,
  });
}

export function adapterHandlesDomain(adapter, domain) {
  return describeSolverCapabilities(adapter).domains.includes(domain);
}

const CONFORMANCE_PROBLEM = Object.freeze({
  schema: CONSTRAINT_PROBLEM_SCHEMA,
  schemaVersion: 1,
  meta: { id: "conformance", runId: "conformance", createdAt: "2026-08-14T00:00:00.000Z" },
  domain: CONSTRAINT_DOMAINS.ACTOR_ACTION_SELECTION,
  posedBy: "actor",
  variables: [],
  constraints: [],
  objective: null,
  context: {},
});

/**
 * Run the conformance checks against an adapter. Returns `{ ok, failures }`.
 *
 * Deliberately small. Each check is something that, if it failed in production,
 * would be very hard to attribute: a non-deterministic model shows up as a
 * replay mismatch many frames later, and an undeclared domain shows up as a
 * confidently wrong decision.
 */
export async function checkSolverConformance(adapter, { problem = CONFORMANCE_PROBLEM } = {}) {
  const failures = [];

  if (typeof adapter?.solve !== "function") {
    return { ok: false, failures: ["adapter must expose solve(request)"] };
  }

  const capabilities = describeSolverCapabilities(adapter);
  if (capabilities.domains.length === 0) {
    failures.push(
      "adapter declares no constraint domains: the port cannot route to it, and an adapter that "
      + "answers a domain it never claimed is worse than one that defers",
    );
  }

  // 1. A result is always shaped, never thrown. The port normalizes errors into
  //    a status; an adapter that throws past it takes the whole tick with it.
  let first;
  try {
    first = await adapter.solve({ problem: { data: problem } });
  } catch (error) {
    failures.push(`solve() threw instead of returning a status: ${error?.message}`);
    return { ok: false, failures };
  }
  if (!first || typeof first.status !== "string") {
    failures.push("solve() must return an object carrying a `status`");
    return { ok: false, failures };
  }
  if (!Object.values(CONSTRAINT_RESULT_STATUS).includes(first.status)) {
    failures.push(
      `status "${first.status}" is not one of ${Object.values(CONSTRAINT_RESULT_STATUS).join(", ")}`,
    );
  }

  // 2. DETERMINISM. The same problem twice must give the same answer. This is
  //    the check that decides whether an adapter may be used in a replayed run.
  const second = await adapter.solve({ problem: { data: problem } });
  const firstModel = JSON.stringify(first.model ?? null);
  const secondModel = JSON.stringify(second?.model ?? null);
  if (first.status !== second?.status || firstModel !== secondModel) {
    failures.push(
      "solve() is not deterministic: the same problem produced different answers. Replay "
      + "compares runs frame by frame, so this breaks `ak replay` rather than degrading it. "
      + `(${first.status}/${firstModel} vs ${second?.status}/${secondModel})`,
    );
  } else if (!capabilities.deterministic) {
    failures.push(
      "adapter behaved deterministically but does not DECLARE `capabilities.deterministic`. "
      + "The declaration is what the port trusts; behaving well by accident is not a guarantee.",
    );
  }

  // 3. An unsatisfiable answer must say why. The reason a solver is preferred to
  //    the greedy loop it replaces is that it can explain infeasibility; an
  //    unexplained `unsat` gives back less than the code it displaced.
  if (first.status === CONSTRAINT_RESULT_STATUS.UNSAT && !first.reason) {
    failures.push("an `unsat` result must carry a `reason`");
  }

  return { ok: failures.length === 0, failures };
}
