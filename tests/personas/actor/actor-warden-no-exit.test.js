/**
 * Wardens do not seek the exit. Delvers path to exitApproach (wall-portal model).
 *
 * Plan M3 — portal-in-wall + approach dwell: EXIT_PROGRESS / advance_to_exit / exit
 * pathfinding apply to delvers only. Wardens may stand on the exit approach but must
 * not retire via dwell (exitEligible=0 in core) and must not propose exit-closing moves.
 */
"use strict";

const assert = require("node:assert/strict");

let modulesPromise;
function loadModules() {
  modulesPromise ??= Promise.all([
    import("../../../packages/runtime/src/personas/actor/persona.js"),
    import("../../../packages/runtime/src/personas/_shared/tick-state-machine.mts"),
  ]);
  return modulesPromise;
}

// Border wall portals: S on west wall, E on east wall; approaches are the interior floors.
const BASE_TILES = [
  "#####",
  "S...#",
  "#...#",
  "#...E",
  "#####",
];

const EXIT = { x: 4, y: 3 };
const EXIT_APPROACH = { x: 3, y: 3 };

function chebyshev(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

async function propose({ role, position, motivation = { kind: "exploring" } }) {
  const [{ createActorPersona }, { TickPhases }] = await loadModules();
  const persona = createActorPersona({ clock: () => "fixed" });
  const self = {
    id: `${role}_1`,
    kind: 2,
    role,
    position,
    motivation,
  };
  const payload = {
    actorId: self.id,
    observation: {
      tick: 0,
      actors: [self],
      exit: EXIT,
      exitApproach: EXIT_APPROACH,
    },
    baseTiles: BASE_TILES,
    exit: EXIT,
    exitApproach: EXIT_APPROACH,
    simConfig: {
      layout: {
        data: {
          tiles: BASE_TILES,
          exit: EXIT,
          exitApproach: EXIT_APPROACH,
        },
      },
    },
    initialState: { actors: [{ id: self.id, role, kind: "motivated" }] },
  };
  persona.advance({ phase: TickPhases.OBSERVE, event: "observe", payload, tick: 0 });
  persona.advance({ phase: TickPhases.DECIDE, event: "decide", payload, tick: 0 });
  const result = persona.advance({ phase: TickPhases.DECIDE, event: "propose", payload, tick: 0 });
  return result.actions || [];
}

test("warden with exploring motivation does not propose an exit-closing move", async () => {
  const start = { x: 1, y: 1 };
  const actions = await propose({ role: "warden", position: start });
  const moves = actions.filter((action) => action.kind === "move");
  for (const move of moves) {
    const to = move.params?.to;
    assert.ok(to, "move proposals include a destination");
    assert.ok(
      chebyshev(to, EXIT_APPROACH) >= chebyshev(start, EXIT_APPROACH),
      "warden must not close distance to the exit approach",
    );
  }
  assert.ok(
    moves.length === 0 || actions.some((action) => action.kind === "wait"),
    "warden holds (wait) or emits no exit-seeking move",
  );
});

test("delver still proposes a move that reduces distance to exit approach", async () => {
  const start = { x: 1, y: 1 };
  const actions = await propose({ role: "delver", position: start });
  const move = actions.find((action) => action.kind === "move");
  assert.ok(move, "delver must propose a move toward the exit approach");
  const to = move.params?.to;
  assert.ok(to, "delver move includes destination");
  assert.ok(
    chebyshev(to, EXIT_APPROACH) < chebyshev(start, EXIT_APPROACH),
    `delver should close on exitApproach; start=${chebyshev(start, EXIT_APPROACH)} after=${chebyshev(to, EXIT_APPROACH)}`,
  );
});
