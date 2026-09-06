import assert from "node:assert/strict";
import { describe, test } from "vitest";

import {
  derivePortalApproach,
  generateGridLayoutFromInput,
} from "../../../packages/runtime/src/personas/configurator/level-layout.js";
import { placeActors } from "../../../packages/runtime/src/personas/configurator/actor-placement.js";

describe("configurator portal placement", () => {
  test("derivePortalApproach returns the unique interior floor neighbor", () => {
    const isInteriorFloor = (x, y) => x === 1 && y === 1;
    assert.deepEqual(
      derivePortalApproach({ x: 0, y: 1 }, { width: 3, height: 3, isInteriorFloor }),
      { x: 1, y: 1 },
    );
    assert.equal(
      derivePortalApproach({ x: 1, y: 1 }, {
        width: 3,
        height: 3,
        isInteriorFloor: (x, y) => (x === 0 && y === 1) || (x === 2 && y === 1),
      }),
      null,
    );
  });

  test("generated layouts place S/E on walls with walkable approaches", () => {
    for (const seed of [1, 7, 11, 42]) {
      const result = generateGridLayoutFromInput({
        width: 21,
        height: 15,
        seed,
        roomCount: 3,
      });
      assert.equal(result.ok, true, JSON.stringify(result.errors));
      const layout = result.value;
      assert.ok(layout.spawnApproach, `seed ${seed} missing spawnApproach`);
      assert.ok(layout.exitApproach, `seed ${seed} missing exitApproach`);
      assert.equal(layout.tiles[layout.spawn.y][layout.spawn.x], "S");
      assert.equal(layout.tiles[layout.exit.y][layout.exit.x], "E");
      assert.equal(layout.tiles[layout.spawnApproach.y][layout.spawnApproach.x], ".");
      assert.equal(layout.tiles[layout.exitApproach.y][layout.exitApproach.x], ".");
      // Portal cells are on the perimeter or against carved floor (wall glyph overwritten by S/E).
      const spawnApproach = derivePortalApproach(layout.spawn, {
        width: layout.width,
        height: layout.height,
        isInteriorFloor: (x, y) => {
          const g = layout.tiles[y]?.[x];
          return g === "." || g === "B";
        },
      });
      assert.deepEqual(spawnApproach, layout.spawnApproach);
    }
  });

  test("placeActors seats first delver on spawnApproach and first warden on exitApproach", () => {
    const layout = {
      width: 7,
      height: 5,
      tiles: [
        "#######",
        "S.....#",
        "#.....#",
        "#.....E",
        "#######",
      ],
      legend: {
        "#": { tile: "wall" },
        ".": { tile: "floor" },
        S: { tile: "spawn" },
        E: { tile: "exit" },
      },
      spawn: { x: 0, y: 1 },
      exit: { x: 6, y: 3 },
      spawnApproach: { x: 1, y: 1 },
      exitApproach: { x: 5, y: 3 },
      rooms: [
        { id: "entry", x: 1, y: 1, width: 5, height: 3 },
        { id: "exit", x: 1, y: 1, width: 5, height: 3 },
      ],
      entryRoomId: "entry",
      exitRoomId: "exit",
    };

    const { actors, changed } = placeActors({
      actors: [
        { id: "delver_1", role: "delver" },
        { id: "warden_1", role: "warden" },
      ],
      layout,
      delverCount: 1,
    });
    assert.equal(changed, true);
    assert.deepEqual(actors.find((a) => a.id === "delver_1").position, { x: 1, y: 1 });
    assert.deepEqual(actors.find((a) => a.id === "warden_1").position, { x: 5, y: 3 });
  });
});
