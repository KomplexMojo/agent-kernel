// PX.3 extended beyond personas: this module defaulted its clock to
// `() => new Date().toISOString()`, the exact pattern require-clock.js removed from
// every persona. The rule was enforced on personas/ only, so five modules kept the
// default and nothing objected. UNUSED_CLOCK is the repo's deterministic marker: a
// caller that forgets to inject now gets a reproducible value, not wall-clock time.
import { UNUSED_CLOCK } from "../personas/_shared/require-clock.js";
function buildResultMeta(requestMeta, clock) {
  return {
    id: requestMeta?.id || requestMeta?.runId || "solver_result",
    runId: requestMeta?.runId || "run_unknown",
    createdAt: clock(),
    producedBy: "solver",
    correlationId: requestMeta?.correlationId,
  };
}

export function createSolverPort({ clock = UNUSED_CLOCK } = {}) {
  async function solve(adapter, request) {
    if (!adapter?.solve) {
      throw new Error("Solver adapter is missing a solve(request) method.");
    }
    try {
      const result = await adapter.solve(request);
      const status = result?.status || "fulfilled";
      const response = {
        ...result,
        status,
        meta: result?.meta || buildResultMeta(request?.meta, clock),
      };
      if (status === "deferred" && !response.reason) {
        response.reason = "solver_deferred";
      }
      return response;
    } catch (err) {
      return {
        status: "error",
        reason: err?.message || "solver_error",
        meta: buildResultMeta(request?.meta, clock),
      };
    }
  }

  return {
    solve,
  };
}

export async function solveWithAdapter(adapter, request, options = {}) {
  const port = createSolverPort(options);
  return port.solve(adapter, request);
}

/**
 * #557: the key a recorded solver answer is filed under: a 53-bit hash of the request's problem,
 * so a host that recorded a solver's answers (`AK_SOLVER_RECORD`) and one that replays them
 * (the phone app has no solver) agree on which answer belongs to which question.
 */
export function solverAnswerKey(request) {
  const text = JSON.stringify(request?.problem ?? request ?? null);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
