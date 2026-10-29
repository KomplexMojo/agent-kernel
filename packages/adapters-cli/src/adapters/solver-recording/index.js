/**
 * Records a solver adapter's answers (#557): every answered request is appended to `path` as one
 * JSON line, `{ key, result }`, keyed by the runtime's `solverAnswerKey`. `ak create` turns it on
 * with `AK_SOLVER_RECORD=<file>`; the phone build reads the file so the browser, which has no
 * solver, replays exactly what z3 decided here. The wrapped adapter's answers are unchanged.
 */
import { appendFileSync } from "node:fs";
import { solverAnswerKey } from "../../../../runtime/src/ports/solver.js";

export function withSolverRecording(adapter, path) {
  return {
    ...adapter,
    kind: adapter?.kind,
    capabilities: adapter?.capabilities,
    async solve(request) {
      const result = await adapter.solve(request);
      appendFileSync(path, `${JSON.stringify({ key: solverAnswerKey(request), result })}\n`);
      return result;
    },
  };
}
