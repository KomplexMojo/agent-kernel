function buildResultMeta(requestMeta, clock) {
  return {
    id: requestMeta?.id || requestMeta?.runId || "solver_result",
    runId: requestMeta?.runId || "run_unknown",
    createdAt: clock(),
    producedBy: "solver",
    correlationId: requestMeta?.correlationId,
  };
}

export function createSolverPort({ clock = () => new Date().toISOString() } = {}) {
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
