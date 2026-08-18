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

  return {
    solve,
    kind: "solver-z3-stub",
    /**
     * Z.3 — a fixture stub. It replays whatever it was handed, so it is
     * deterministic by construction, but it models no domain and must never be
     * routed a real question: an adapter that answers a domain it never claimed
     * produces a confidently wrong decision rather than a clean deferral.
     */
    capabilities: {
      domains: [],
      deterministic: true,
    },
  };
}
