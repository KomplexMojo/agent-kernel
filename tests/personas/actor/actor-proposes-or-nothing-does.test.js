/**
 * G1 actor/motivation-to-proposal (A2) — P5.4, 2026-08-12.
 *
 * **The Actor's registered behaviors both covered what it must NOT do** — hold state outside
 * `view()` (CR.6), decide budget admissibility (CR.6) — and neither asked the A2 question
 * about the thing the persona exists for: *can production produce an action stream without
 * it?* Every movement, filter and runtime-decision test drives the persona and then checks
 * its output, which demonstrates the function works. It cannot distinguish a persona that
 * decides from one the runner merely consults before deciding anyway.
 *
 * So this is an ABLATION, not a differential. Two runs of the same fixture through the same
 * runtime, differing in exactly one thing — whether the Actor in the registry proposes
 * anything — and the tick must be unable to make up the difference.
 *
 * ⚠️ **THE CONTROL IS HALF THE TEST.** An ablation that only asserts "no actions when
 * stubbed" passes just as well when the fixture never produced actions at all — the vacuity
 * that made eight façade violations survive a green suite. The control run asserts the same
 * registry, same core and same fixtures DO produce actor actions with a real Actor.
 *
 * ⚠️ **BOTH RUNS USE THE SAME REGISTRY SHAPE.** A caller-supplied persona registry REPLACES
 * the defaults (only the Moderator is backfilled), so building one run from defaults and the
 * other from a hand-built registry would vary two things at once and prove nothing.
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "../../..");
const CLOCK = () => "2026-08-12T00:00:00.000Z";

function fixture(name) {
  return JSON.parse(readFileSync(resolve(ROOT, `tests/fixtures/artifacts/${name}`), "utf8"));
}

/** The tick-plane registry, with the Actor as the one variable. */
async function buildRegistry(actorFactory) {
  const { createAllocatorPersona } = await import(`${MODULES}allocator/persona.js`);
  const { createModeratorPersona } = await import(`${MODULES}moderator/persona.js`);
  const { createAnnotatorPersona } = await import(`${MODULES}annotator/persona.js`);
  // Built exactly as the runtime's own default wiring does: the Actor receives the
  // Allocator's admissibility judge rather than a copy of the policy (CR.6).
  const allocator = createAllocatorPersona({ clock: CLOCK });
  return {
    allocator,
    actor: await actorFactory(allocator),
    moderator: createModeratorPersona({ clock: CLOCK }),
    annotator: createAnnotatorPersona({ clock: CLOCK }),
  };
}

const MODULES = "../../../packages/runtime/src/personas/";

async function runTicks(registry) {
  const { createRuntime } = await import("../../../packages/runtime/src/runner/runtime.js");
  const { createCore } = await import("../../../packages/core-ts/src/index.ts");

  const runtime = createRuntime({ core: createCore(), adapters: {}, personas: registry });
  await runtime.init({
    seed: 0,
    simConfig: fixture("sim-config-artifact-v1-mvp-grid.json"),
    initialState: fixture("initial-state-artifact-v1-mvp-actor.json"),
    runId: "run_g1_actor_ablation",
  });
  for (let i = 0; i < 3; i += 1) await runtime.step();

  return runtime.getTickFrames()
    .filter((frame) => frame?.phaseDetail === "decide")
    .flatMap((frame) => frame.personaActions || []);
}

/** An Actor that observes and transitions like the real one, but proposes nothing. */
function stubActor() {
  let state = "idle";
  return {
    subscribePhases: ["observe", "decide"],
    advance() {
      state = state === "idle" ? "observing" : "deciding";
      return { state, context: {}, actions: [], effects: [], telemetry: null };
    },
    view: () => ({ state, context: {} }),
  };
}

test("G1 actor/motivation-to-proposal: with the Actor neutered, production proposes nothing", async () => {
  const { createActorPersona } = await import(`${MODULES}actor/persona.js`);

  // CONTROL — the real Actor, same everything else.
  const withActor = await runTicks(
    await buildRegistry((allocator) => createActorPersona({
      clock: CLOCK,
      admitProposals: allocator.admitProposals,
    })),
  );
  assert.ok(
    withActor.length > 0,
    "precondition: this fixture must actually produce actor actions, or the ablation below "
      + "is vacuous — the exact way a façade passes an output test",
  );

  // ABLATION — the only change is an Actor that decides nothing.
  const withoutActor = await runTicks(await buildRegistry(() => stubActor()));
  assert.deepEqual(
    withoutActor,
    [],
    "production emitted actions while the Actor proposed none — something other than the "
      + "Actor is deciding what actors do, which is an A2 violation however the call is routed",
  );
});

// ## TODO: Test Permutations
// - an Actor that proposes an INADMISSIBLE action: production must drop it, and the drop must
//   come from the Allocator's judge rather than from the runner
// - multi-actor rosters: neutering ONE actor's turn, not the persona
// - the same ablation on the APPLY phase: no proposals ⇒ no core mutations
