// CLI stub solver adapter (deterministic, no external IO).

import { readFileSync } from "node:fs";

function loadFixture(path) {
  if (!path) return null;
  try {
    const data = readFileSync(path, "utf8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export function createSolverAdapter({ fixturePath } = {}) {
  const fixture = loadFixture(fixturePath);

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
