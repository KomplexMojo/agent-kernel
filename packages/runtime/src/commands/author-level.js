/**
 * A level from `ak create` arguments, by the code `ak create` runs, wherever it runs (#557):
 * the authoring grammar and request (authoring-specs.js), then the authoring build with the
 * Configurator's placement posed to the host's solver adapter. The CLI writes the result to
 * disk; the phone app plays it in the browser. Nothing here reads a file or the clock.
 */
import { runAuthoringBuild } from "../build/authoring-build.js";
import { createAuthoringSpecs, parseArgs } from "./authoring-specs.js";
import { hostConfiguratorPlacement } from "./solver-host.js";

/** The authoring build with object placement hosted on `adapter`; `solverDecisions` says what decided it. */
export async function runHostedAuthoringBuild(input, { adapter } = {}) {
  const solverDecisions = [];
  const placeObjects = hostConfiguratorPlacement({
    createdAt: input?.createdAt,
    adapter,
    record: (decision) => solverDecisions.push(decision),
  });
  return runAuthoringBuild({ ...input, placeObjects, solverDecisions });
}

function refuse(what) {
  return () => {
    throw new Error(`${what} is not available here; give the level its --run-id, --created-at and --seed.`);
  };
}

/**
 * Build a level from `ak create`'s argv. `argv` must name `--run-id` and `--created-at` (and
 * `--seed` for a tactic), since no clock, id or randomness is read here. Budget and price-list
 * files and `--tactic llm` are refused: they need the host's IO.
 * @returns {Promise<{ buildResult: object, prepared: object }>}
 */
export async function authorLevel(argv, { adapter, commandName = "create" } = {}) {
  const specs = createAuthoringSpecs({ makeId: refuse("an unnamed run") });
  const prepared = await specs.prepareAuthoringBuild(parseArgs(argv), { commandName, action: "author", allowDryRun: true }, {
    readArtifact: refuse("reading a budget or price-list file"),
    drawSeed: refuse("drawing a seed"),
    planTacticsWithLlm: refuse("an LLM tactic plan"),
    now: refuse("the clock"),
  });
  const { buildResult } = await runHostedAuthoringBuild(prepared.buildInput, { adapter });
  return { buildResult, prepared };
}
