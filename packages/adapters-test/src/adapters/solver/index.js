// Test solver adapter: deterministic fixture lookup.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadFixture(idOrLabel) {
  if (!idOrLabel) return null;
  const filename = `solver-result-${idOrLabel}.json`;
  const path = resolve(process.cwd(), "tests/fixtures/artifacts", filename);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function createTestSolverAdapter() {
  async function solve(request) {
    const id = request?.meta?.id || request?.meta?.runId || request?.label;
    const fixture = loadFixture(id);
    if (fixture) {
      return fixture;
    }
    return { status: "deferred", reason: "missing_fixture" };
  }

  return { solve };
}
