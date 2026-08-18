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
