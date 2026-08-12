// Web stub solver adapter: deterministic, fixture-friendly.

export function createWebSolverAdapter({ fixture } = {}) {
  async function solve(request) {
    if (fixture) {
      return fixture;
    }
    return {
      status: "fulfilled",
      request,
      result: { note: "stubbed_solver_result" },
    };
  }

  return { solve };
}
