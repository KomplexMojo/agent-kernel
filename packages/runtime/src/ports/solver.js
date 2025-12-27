function buildResultMeta(requestMeta) {
  return {
    id: `solver_${Date.now().toString(36)}`,
    runId: requestMeta?.runId || "run_unknown",
    createdAt: new Date().toISOString(),
    producedBy: "solver",
    correlationId: requestMeta?.correlationId,
  };
}

export async function solveWithAdapter(adapter, request) {
  if (!adapter?.solve) {
    throw new Error("Solver adapter is missing a solve(request) method.");
  }
  const result = await adapter.solve(request);
  if (!result?.meta) {
    result.meta = buildResultMeta(request?.meta);
  }
  return result;
}
