/**
 * M6 — MCP -> CLI -> UI random-movement scenario pipeline: failing base tests
 *
 * Acceptance scenario (user-facing): "Create a 5 room level with 10 wardens
 * and 1 delver. The wardens and delvers should have random movement
 * motivation. Run the simulation for 100 ticks." driven through the MCP tool
 * surface -> CLI -> the bundle that would be pushed to the UI gameplay
 * surface via the sandbox bridge.
 *
 * Seam driven (exact same seam the MCP server itself uses):
 *   - packages/adapters-cli/src/mcp/tools/authoring.mjs  authoringTools[0]  (ak_create),
 *     authoringSpec/buildArgv -> argv
 *   - packages/adapters-cli/src/mcp/tools/simulation.mjs simulationTools "ak_run" tool,
 *     buildArgv -> argv
 *   - packages/adapters-cli/src/cli/ak-impl.mjs  executeCommand(command, argv)
 *     (packages/adapters-cli/src/mcp/server.mjs:213 calls this exact function
 *     inside invokeCliTool() when a tool has no custom `handler`)
 *
 * Research findings that shape this file (see PR/task notes):
 *   - There is no `ak_create` MCP tool that accepts room/warden/delver COUNTS
 *     via freeform scenario text. `ak_scenario` (packages/adapters-cli/src/cli/ak-impl.mjs
 *     scenarioCommand, ~line 6199) only accepts --text (LLM/fixture-driven) or
 *     --from-run; it does not parse structured entity counts from text itself.
 *   - The deterministic, structured-count path is `ak_create` (authoring.mjs,
 *     command "create") with --room "count=5", --warden "count=10;motivation=random",
 *     --delver "count=1;motivation=random" followed by `ak_run --ticks 100`
 *     (simulation.mjs, command "run"). This is the seam this file drives.
 *   - "random" is a recognized motivation: ak-impl.mjs hasNonStationaryMobilityMotivation
 *     (~line 1322-1324) special-cases "random"/"exploring"/"patrolling" for movement
 *     stamina; parseDelverSpec (~1120-1219) / parseWardenSpec (~1231-1310) validate
 *     `motivation=` against ALLOWED_MOTIVATIONS (imported from
 *     packages/runtime/src/personas/orchestrator/prompt-contract.js) and "random"
 *     is a legal value.
 *   - `count=N` is already supported per single spec string (no need for N
 *     repeated --warden flags) — parseWardenSpec/parseDelverSpec both parse a
 *     `count` field (default 1) via parsePositiveIntStrict.
 *   - `run --ticks 100` runs in-process against core-ts (no shell-out) and
 *     writes tick-frames.json / run-summary.json / effects-log.json /
 *     resolved-sim-config.json / resolved-initial-state.json under outDir
 *     (packages/runtime/src/commands/kernel.js `run()`, called via
 *     commandKernel.run in ak-impl.mjs runCommand ~line 4813-4843).
 *   - The bundle shape consumable by the UI (`window.__ak_loadGameplayBundle`)
 *     is `{ schema: "agent-kernel/GameplayBundle", schemaVersion: 1, meta, artifacts: [simConfig, initialState], spec, tickFrames }`
 *     per packages/runtime/src/runner/core-facade.js compileScenarioPlaybackBundle.
 *     There is currently no MCP tool (`ak_push_to_ui` or otherwise) that goes
 *     from a `create`+`run` CLI outDir to this bundle shape and pushes it over
 *     the sandbox bridge (packages/adapters-cli/src/mcp/bridge-server.mjs
 *     pushGameplayBundle) — that stitching is the expected M7 gap this file
 *     documents and pins with a failing assertion.
 *
 * Architecture: adapters-cli seam only, fixture-first, no live LLM/network,
 * no subprocess (executeCommand runs in-process exactly like the MCP server).
 */
"use strict";

const assert = require("node:assert/strict");
const { mkdtempSync, existsSync, readFileSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const os = require("node:os");

let ak_impl;
let authoringToolsModule;
let simulationToolsModule;

async function loadModules() {
  ak_impl ??= await import("../../packages/adapters-cli/src/cli/ak-impl.mjs");
  authoringToolsModule ??= await import("../../packages/adapters-cli/src/mcp/tools/authoring.mjs");
  simulationToolsModule ??= await import("../../packages/adapters-cli/src/mcp/tools/simulation.mjs");
  return { ak_impl, authoringToolsModule, simulationToolsModule };
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

/**
 * Capture stdout JSON the same way packages/adapters-cli/src/mcp/server.mjs
 * invokeCliTool() does: intercept console.log / process.stdout.write while
 * executeCommand runs, then parse the last JSON line.
 */
async function runCliCommand(executeCommand, command, argv) {
  const stdoutChunks = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  const originalLog = console.log;
  process.stdout.write = (chunk, encoding, callback) => {
    stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
    if (typeof encoding === "function") encoding();
    else if (typeof callback === "function") callback();
    return true;
  };
  console.log = (...parts) => {
    stdoutChunks.push(`${parts.map(String).join(" ")}\n`);
  };
  try {
    await executeCommand(command, argv);
  } finally {
    process.stdout.write = originalWrite;
    console.log = originalLog;
  }
  const text = stdoutChunks.join("").trim();
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      // keep scanning backwards for the JSON payload
    }
  }
  throw new Error(`runCliCommand(${command}): no JSON payload found in stdout:\n${text}`);
}

/**
 * Find the ak_create / ak_run MCP tool definitions and build argv exactly as
 * the MCP server would via tool.buildArgs(args) — this is the real MCP tool
 * surface, not a hand-rolled argv array.
 */
function findTool(tools, name) {
  const tool = tools.find((t) => t.name === name);
  assert.ok(tool, `expected MCP tool definition for ${name}`);
  return tool;
}

describe("MCP -> CLI random-movement scenario pipeline (5 rooms / 10 wardens / 1 delver / 100 ticks)", () => {
  let outDir;
  let runOutDir;

  beforeAll(async () => {
    outDir = mkdtempSync(join(os.tmpdir(), "ak-mcp-cli-ui-random-"));
    runOutDir = join(outDir, "run");
  });

  afterAll(() => {
    if (outDir && existsSync(outDir)) {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  test("ak_create MCP tool produces sim-config + initial-state with 1 delver, 10 wardens, motivation.kind random", async () => {
    const { ak_impl, authoringToolsModule } = await loadModules();
    const createTool = findTool(authoringToolsModule.authoringTools, "ak_create");

    const createArgs = {
      room: ["count=5;size=medium"],
      delver: ["count=1;affinity=water;motivation=random"],
      warden: ["count=10;affinity=fire;motivation=random"],
      runId: "mcp_random_scenario",
      outDir,
    };
    const argv = createTool.buildArgs(createArgs);

    const createResult = await runCliCommand(ak_impl.executeCommand, createTool.command, argv);

    assert.equal(createResult.ok, true, `ak_create must succeed: ${JSON.stringify(createResult)}`);

    // Locate the produced sim-config / initial-state artifacts. The exact
    // artifact file names/paths are the "create" command's contract; assert
    // loosely on discoverability via the result payload first, then fall back
    // to the conventional outDir file names used elsewhere in this repo
    // (see ak-impl.mjs summarizeRunOutput / tests/fixtures/scenarios/*.json).
    const simConfigPath = createResult.artifactPaths?.sim_config
      || createResult.simConfigPath
      || join(outDir, "sim-config.json");
    const initialStatePath = createResult.artifactPaths?.initial_state
      || createResult.initialStatePath
      || join(outDir, "initial-state.json");

    assert.ok(
      existsSync(simConfigPath),
      `ak_create must produce a discoverable SimConfigArtifact (looked at ${simConfigPath}); result=${JSON.stringify(createResult)}`,
    );
    assert.ok(
      existsSync(initialStatePath),
      `ak_create must produce a discoverable InitialStateArtifact (looked at ${initialStatePath}); result=${JSON.stringify(createResult)}`,
    );

    const simConfig = readJson(simConfigPath);
    const initialState = readJson(initialStatePath);

    assert.equal(simConfig.schema, "agent-kernel/SimConfigArtifact");
    assert.equal(simConfig.schemaVersion, 1);
    assert.equal(initialState.schema, "agent-kernel/InitialStateArtifact");
    assert.equal(initialState.schemaVersion, 1);

    // 5 rooms requested via --room "count=5;size=medium".
    //
    // GROUND TRUTH (confirmed by direct invocation during test authoring):
    // ak_create's room-generation path currently produces only 4 rooms for a
    // count=5 request (observed rooms: R1-R4). This looks like an off-by-one
    // or budget/space-capped-fulfillment gap in the room layout generator
    // reachable from agentAuthoringCommand -> orchestrateBuild — not a typo
    // in this test's spec string (the same "count=N" field is confirmed
    // supported and correctly expands delvers/wardens to the requested
    // count, see below). Pinned as a strict failing assertion per the
    // acceptance scenario's literal "5 room level" requirement.
    const rooms = simConfig.layout?.data?.rooms;
    assert.ok(Array.isArray(rooms), "sim-config layout.data.rooms must be an array");
    assert.equal(
      rooms.length,
      5,
      `expected 5 rooms for --room "count=5;size=medium", got ${rooms?.length} ` +
        `(room ids: ${JSON.stringify(rooms?.map((r) => r.id))}) — either the room-count ` +
        "fulfillment path under agentAuthoringCommand/orchestrateBuild is capping below the " +
        "requested count, or this test's understanding of the count= contract needs correction",
    );

    // Exactly 1 delver + 10 wardens (count expansion works correctly today).
    const actors = Array.isArray(initialState.actors) ? initialState.actors : [];
    const delvers = actors.filter((a) => a.archetype === "delver");
    const wardens = actors.filter((a) => a.archetype === "warden");

    assert.equal(delvers.length, 1, `expected exactly 1 delver, got ${delvers.length}`);
    assert.equal(wardens.length, 10, `expected exactly 10 wardens, got ${wardens.length}`);

    // Actor ids must be unique across the 11 actors (this already passes —
    // card_delver_1-1, card_warden_1-1..card_warden_1-10 observed).
    const ids = actors.map((a) => a.id);
    assert.equal(new Set(ids).size, ids.length, "all actor ids must be unique");

    // GROUND TRUTH GAP: motivation=random passed on --delver/--warden is used
    // by ak-impl.mjs only for authoring-time cost calculation
    // (hasNonStationaryMobilityMotivation / requiresMovementStamina, ~line
    // 1322-1329) — it is never written onto the actor record in
    // InitialStateArtifact. Actors produced by `create` today have NO
    // `motivation` field at all (confirmed: card_delver_1-1 / card_warden_1-*
    // only carry id/kind/position/vitals/archetype/traits). This is the core
    // M6->M7 gap for the acceptance scenario: without motivation.kind
    // "random" reaching InitialState, the runtime persona layer
    // (packages/runtime/src/personas/actor/controller.mts, see
    // tests/runtime/random-movement-ticks.test.js) has nothing to key off of
    // for these CLI-authored actors, even though the persona-level "random"
    // behavior itself is already implemented and working (M3, verified below
    // via direct runtime execution in the next test).
    for (const actor of [...delvers, ...wardens]) {
      assert.equal(
        actor.motivation?.kind,
        "random",
        `actor ${actor.id} must have motivation.kind "random" in InitialStateArtifact, ` +
          `got ${JSON.stringify(actor.motivation)} (full actor: ${JSON.stringify(actor)}) — ` +
          "ak_create's authoring pipeline does not thread the --delver/--warden motivation= " +
          "field through to the actor record it writes; it is consumed only for cost calc",
      );
    }
  });

  test("ak_run MCP tool runs 100 ticks against the created sim-config/initial-state and produces tick-frames covering all 100 ticks", async () => {
    const { ak_impl, authoringToolsModule, simulationToolsModule } = await loadModules();
    const createTool = findTool(authoringToolsModule.authoringTools, "ak_create");
    const runTool = findTool(simulationToolsModule.simulationTools, "ak_run");

    // Recreate deterministically in an isolated outDir (independent from the
    // previous test so this test can be run/read in isolation).
    const createArgv = createTool.buildArgs({
      room: ["count=5;size=medium"],
      delver: ["count=1;affinity=water;motivation=random"],
      warden: ["count=10;affinity=fire;motivation=random"],
      runId: "mcp_random_scenario_run",
      outDir,
    });
    const createResult = await runCliCommand(ak_impl.executeCommand, createTool.command, createArgv);
    assert.equal(createResult.ok, true, `ak_create must succeed: ${JSON.stringify(createResult)}`);

    const simConfigPath = createResult.artifactPaths?.sim_config
      || createResult.simConfigPath
      || join(outDir, "sim-config.json");
    const initialStatePath = createResult.artifactPaths?.initial_state
      || createResult.initialStatePath
      || join(outDir, "initial-state.json");

    const runArgv = runTool.buildArgs({
      simConfig: simConfigPath,
      initialState: initialStatePath,
      ticks: 100,
      seed: 1,
      runId: "mcp_random_scenario_run",
      outDir: runOutDir,
    });

    const runResult = await runCliCommand(ak_impl.executeCommand, runTool.command, runArgv);
    assert.equal(runResult.ok, true, `ak_run must succeed: ${JSON.stringify(runResult)}`);
    assert.equal(runResult.command, "run");
    assert.equal(runResult.ticks, 100, `run summary must report ticks=100, got ${runResult.ticks}`);

    const tickFramesPath = runResult.artifactPaths?.tick_frames || join(runOutDir, "tick-frames.json");
    assert.ok(existsSync(tickFramesPath), `run must produce tick-frames.json at ${tickFramesPath}`);

    const tickFrames = readJson(tickFramesPath);
    assert.ok(Array.isArray(tickFrames), "tick-frames.json must be a JSON array");

    // GROUND TRUTH: tick-frames.json records one agent-kernel/TickFrame per
    // sub-phase of the six-phase tick orchestration (init, observe, decide,
    // apply, emit, summarize — see runtime-fsm.mjs), not one frame per tick.
    // For --ticks 100 this yields 501 records (100 ticks x ~5 phases + 1
    // init frame), which is already correct and confirmed by run-summary.json
    // (metrics: { ticks: 100, frames: 501, ... }). The meaningful contract is
    // distinct `tick` value coverage 0..100 inclusive (101 values), not raw
    // array length.
    const tickNumbers = tickFrames.map((frame) => frame.tick);
    const distinctTicks = new Set(tickNumbers);
    const minTick = Math.min(...tickNumbers);
    const maxTick = Math.max(...tickNumbers);
    assert.equal(minTick, 0, `tick coverage must start at tick 0, got ${minTick}`);
    assert.equal(maxTick, 100, `tick coverage must reach tick 100 (--ticks 100), got ${maxTick}`);
    assert.equal(distinctTicks.size, 101, `expected 101 distinct tick values (0..100 inclusive), got ${distinctTicks.size}`);

    const runSummaryPath = join(runOutDir, "run-summary.json");
    if (existsSync(runSummaryPath)) {
      const runSummary = readJson(runSummaryPath);
      assert.equal(runSummary.metrics?.ticks, 100, `run-summary.json metrics.ticks must be 100, got ${runSummary.metrics?.ticks}`);
    }

    // Accepted move actions must be present somewhere across the run — random
    // motivation actors in a 5-room level should move at least once in 100 ticks.
    // NOTE: this assertion exercises the runtime's own persona-level random
    // movement (already implemented per M3 / tests/runtime/random-movement-ticks.test.js)
    // operating on whatever motivation ended up in InitialState. Given the
    // "ak_create drops motivation" gap pinned in the previous test, actors run
    // here may have NO motivation at all, in which case the persona falls back
    // to exit-directed pathfinding rather than "random" — moves may still be
    // accepted, but they will not be reason:"random". We assert move presence
    // here (a coarser, still-meaningful signal) and leave the reason:"random"
    // tagging to the runtime-level tests, since that contract is about the
    // actor persona, not this CLI/MCP seam.
    const allActions = tickFrames.flatMap((frame) => (Array.isArray(frame.acceptedActions) ? frame.acceptedActions : []));
    const acceptedMoves = allActions.filter((action) => action.kind === "move");
    assert.ok(
      acceptedMoves.length > 0,
      `expected at least one accepted move action across 100 ticks; saw ${allActions.length} total accepted actions`,
    );

    // Actor ids must be preserved (never renamed/dropped) across every
    // accepted action recorded through the run.
    const initialState = readJson(initialStatePath);
    const expectedIds = new Set(initialState.actors.map((a) => a.id));
    for (const action of allActions) {
      assert.ok(expectedIds.has(action.actorId), `accepted action at tick ${action.tick} references unexpected actorId ${action.actorId}`);
    }
  });

  test("bundle produced from the create+run outDir matches the agent-kernel/GameplayBundle shape expected by __ak_loadGameplayBundle (M7 stitching gap)", async () => {
    const { ak_impl, authoringToolsModule, simulationToolsModule } = await loadModules();
    const createTool = findTool(authoringToolsModule.authoringTools, "ak_create");
    const runTool = findTool(simulationToolsModule.simulationTools, "ak_run");

    const bundleOutDir = mkdtempSync(join(os.tmpdir(), "ak-mcp-cli-ui-bundle-"));
    try {
      const createArgv = createTool.buildArgs({
        room: ["count=5;size=medium"],
        delver: ["count=1;affinity=water;motivation=random"],
        warden: ["count=10;affinity=fire;motivation=random"],
        runId: "mcp_random_scenario_bundle",
        outDir: bundleOutDir,
      });
      const createResult = await runCliCommand(ak_impl.executeCommand, createTool.command, createArgv);
      assert.equal(createResult.ok, true, `ak_create must succeed: ${JSON.stringify(createResult)}`);

      const simConfigPath = createResult.artifactPaths?.sim_config
        || createResult.simConfigPath
        || join(bundleOutDir, "sim-config.json");
      const initialStatePath = createResult.artifactPaths?.initial_state
        || createResult.initialStatePath
        || join(bundleOutDir, "initial-state.json");

      const runArgv = runTool.buildArgs({
        simConfig: simConfigPath,
        initialState: initialStatePath,
        ticks: 100,
        seed: 1,
        runId: "mcp_random_scenario_bundle",
        outDir: join(bundleOutDir, "run"),
      });
      const runResult = await runCliCommand(ak_impl.executeCommand, runTool.command, runArgv);
      assert.equal(runResult.ok, true, `ak_run must succeed: ${JSON.stringify(runResult)}`);

      // GROUND TRUTH: ak_create DOES already write a bundle.json
      // (createResult.artifactPaths.bundle), confirmed by direct invocation
      // during test authoring. But its shape is NOT the
      // "agent-kernel/GameplayBundle" schema that __ak_loadGameplayBundle /
      // the sandbox bridge client expect (see
      // packages/runtime/src/runner/core-facade.js compileScenarioPlaybackBundle
      // and packages/ui-web/src/sandbox-bridge-client.js handleBundle). The
      // observed create-time bundle.json is `{ spec, schemas, artifacts }`
      // with NO `schema`/`schemaVersion` field and NO `tickFrames` — it is a
      // BuildSpec-preview bundle (produced before any ticks have run), not a
      // post-run playback bundle. This is the precise M6->M7 gap: nothing in
      // the CLI/MCP surface merges the create-time bundle.json with the
      // run-time tick-frames.json into an agent-kernel/GameplayBundle.
      const bundlePath = join(bundleOutDir, "bundle.json");
      assert.ok(existsSync(bundlePath), `ak_create must write bundle.json at ${bundlePath} (this part already works)`);

      const bundle = readJson(bundlePath);
      assert.equal(
        bundle.schema,
        "agent-kernel/GameplayBundle",
        `create-time bundle.json has no "agent-kernel/GameplayBundle" schema tag (got schema=${JSON.stringify(bundle.schema)}, ` +
          `top-level keys=${JSON.stringify(Object.keys(bundle))}) — it is a pre-run BuildSpec preview bundle ` +
          "{spec, schemas, artifacts}, not the post-run playback bundle __ak_loadGameplayBundle expects. " +
          "No MCP/CLI seam yet merges this with tick-frames.json into a real GameplayBundle (the ak_push_to_ui gap).",
      );
      assert.equal(bundle.schemaVersion, 1);
      assert.ok(Array.isArray(bundle.artifacts) && bundle.artifacts.length >= 2, "bundle.artifacts must include sim-config and initial-state");
      assert.ok(
        Array.isArray(bundle.tickFrames) && bundle.tickFrames.length > 0,
        `bundle must carry the recorded tick frames from the run (got tickFrames=${JSON.stringify(bundle.tickFrames)}) — ` +
          "create-time bundle.json is written before ak_run executes and cannot contain them without an M7 stitching step",
      );
    } finally {
      rmSync(bundleOutDir, { recursive: true, force: true });
    }
  });

  test("no ak_push_to_ui MCP tool exists yet to deliver the bundle over the sandbox bridge (M7 gap)", async () => {
    // sandboxTools currently exposes ak_sandbox_create / ak_sandbox_place /
    // ak_sandbox_move only (packages/adapters-cli/src/mcp/tools/sandbox.mjs) —
    // none of these push a compiled GameplayBundle over the WS bridge
    // (packages/adapters-cli/src/mcp/bridge-server.mjs pushGameplayBundle).
    // This assertion documents and pins that gap per the sandbox-consolidation
    // plan (rename -> ak_push_to_ui) so it fails loudly until M7 wires it up.
    const sandboxToolsModule = await import("../../packages/adapters-cli/src/mcp/tools/sandbox.mjs");
    const server = await import("../../packages/adapters-cli/src/mcp/server.mjs").catch(() => null);
    void server; // server.mjs self-connects a stdio transport on import; avoid importing it directly here.

    const toolNames = sandboxToolsModule.sandboxTools.map((t) => t.name);
    assert.ok(
      toolNames.includes("ak_push_to_ui"),
      `expected an "ak_push_to_ui" MCP tool wiring create/run output to the sandbox bridge; found tools: ${toolNames.join(", ")}`,
    );
  });
});

test.skip("mcp cli random scenario ticks=1 produces exactly one tick frame with actor snapshot", () => {});
test.skip("mcp cli random scenario ticks=10 has no final-frame off-by-one", () => {});
test.skip("mcp cli random scenario ticks=100 without seed uses deterministic default seed", () => {});
test.skip("mcp cli random scenario supports delver-only and warden-only role counts", () => {});
test.skip("mcp cli random scenario supports count=1 and count=50 role-count boundaries", () => {});
test.skip("mcp cli random scenario missing motivation defaults per delver and warden parsers", () => {});
test.skip("mcp cli random scenario keeps exploring and patrolling distinct from random", () => {});
test.skip("mcp cli random scenario reports room-count mismatch from budget-capped fulfillment", () => {});
test.skip("mcp cli random scenario repeated run with same seed yields byte-identical tick frames", () => {});
test.skip("mcp cli random scenario rejects out-of-range negative ticks with structured error", () => {});
