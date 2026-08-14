const assert = require("node:assert/strict");

const CLOCK = () => "2026-08-01T00:00:00.000Z";

const CASES = [
  {
    name: "actor",
    load: () => import("../../packages/runtime/src/personas/actor/persona.js"),
    factory: "createActorPersona",
    drive: { phase: "observe", event: "observe", payload: {}, tick: 1 },
    next: { phase: "decide", event: "decide", payload: {}, tick: 2 },
  },
  {
    name: "allocator",
    load: () => import("../../packages/runtime/src/personas/allocator/persona.js"),
    factory: "createAllocatorPersona",
    drive: { phase: "decide", event: "budget", payload: { budgets: [{ id: "budget:1" }] }, tick: 1 },
    next: { phase: "decide", event: "allocate", payload: { budgets: [{ id: "budget:1" }] }, tick: 2 },
  },
  {
    name: "annotator",
    load: () => import("../../packages/runtime/src/personas/annotator/persona.js"),
    factory: "createAnnotatorPersona",
    drive: { phase: "emit", event: "observe", payload: { observations: [{ kind: "note" }] }, tick: 1 },
    next: { phase: "summarize", event: "summarize", payload: { observations: [{ kind: "note" }] }, tick: 2 },
  },
  {
    name: "configurator",
    load: () => import("../../packages/runtime/src/personas/configurator/persona.js"),
    factory: "createConfiguratorPersona",
    drive: { phase: "observe", event: "provide_config", payload: { config: { seed: 1 }, configRef: "cfg:1" }, tick: 1 },
    next: { phase: "decide", event: "validate", payload: { config: { seed: 1 } }, tick: 2 },
  },
  {
    name: "director",
    load: () => import("../../packages/runtime/src/personas/director/persona.js"),
    factory: "createDirectorPersona",
    drive: { phase: "decide", event: "bootstrap", payload: { intentRef: "intent:1" }, tick: 1 },
    next: { phase: "decide", event: "ingest_intent", payload: { intentRef: "intent:1" }, tick: 2 },
  },
  {
    name: "moderator",
    load: () => import("../../packages/runtime/src/personas/moderator/persona.js"),
    factory: "createModeratorPersona",
    drive: { phase: "init", event: "start", payload: {}, tick: 1 },
    next: { phase: "decide", event: "pause", payload: {}, tick: 2 },
  },
  {
    name: "orchestrator",
    load: () => import("../../packages/runtime/src/personas/orchestrator/persona.js"),
    factory: "createOrchestratorPersona",
    drive: { phase: "decide", event: "plan", payload: {}, tick: 1 },
    next: { phase: "decide", event: "start_run", payload: { planRef: "plan:1" }, tick: 2 },
  },
];

function comparableResult(result) {
  return {
    state: result.state,
    actions: result.actions,
    effects: result.effects,
    telemetry: result.telemetry,
  };
}

test.each(CASES)("$name persona is equivalent after a JSON view round-trip", async ({
  load,
  factory,
  drive,
  next,
}) => {
  const module = await load();
  const createPersona = module[factory];
  const original = createPersona({ clock: CLOCK });
  original.advance(drive);

  const serializedView = JSON.parse(JSON.stringify(original.view()));
  const restored = createPersona({ clock: CLOCK, from: serializedView });
  assert.deepEqual(restored.view(), serializedView);

  const expected = comparableResult(original.advance(next));
  const actual = comparableResult(restored.advance(next));
  assert.deepEqual(actual, expected);
});

// ## TODO: Test Permutations
// - reject snapshots whose state is not part of the target persona's state codebook
// - reject snapshots with null, array, or primitive context values
// - preserve nested JSON payloads without sharing mutable references with the source view
