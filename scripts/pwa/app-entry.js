/**
 * The phone app's composition root (#557): the page (ui-ascii's browser.js) gets a level builder
 * that runs `ak create`'s own authoring code in the browser (runtime's `authorLevel`), with the
 * solver's part answered from what z3 decided when the level was first built (adapters-web's
 * recorded-answers adapter). The page imports neither; it is handed the builder.
 */
import { startAppSafely } from "../../packages/ui-ascii/src/browser.js";
import { authorLevel } from "../../packages/runtime/src/commands/author-level.js";
import { createRecordedSolverAdapter } from "../../packages/adapters-web/src/adapters/solver-recorded/index.js";

startAppSafely({
  async buildLevel({ argv, solverAnswers }) {
    const { buildResult } = await authorLevel(argv, { adapter: createRecordedSolverAdapter(solverAnswers) });
    return {
      simConfig: buildResult.simConfig,
      initialState: buildResult.initialState,
      budgetReceipt: buildResult.budgetReceipt,
      solverDecisions: buildResult.solverDecisions ?? [],
    };
  },
});
