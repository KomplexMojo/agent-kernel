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
      const at = ({ x, y }) => layout.terrain[y * layout.width + x];
      const marker = (kind) => {
        const index = layout.terrain.indexOf(kind);
        return { x: index % layout.width, y: Math.floor(index / layout.width) };
      };
      const spawn = marker("spawn");
      const exit = marker("exit");
      assert.equal(at(spawn), "spawn");
      assert.equal(at(exit), "exit");
      assert.equal(at(layout.spawnApproach), "floor");
      assert.equal(at(layout.exitApproach), "floor");
      // Portal cells are on the perimeter or against carved floor (wall glyph overwritten by S/E).
      const spawnApproach = derivePortalApproach(spawn, {
        width: layout.width,
        height: layout.height,
        isInteriorFloor: (x, y) => at({ x, y }) === "floor",
      });
      assert.deepEqual(spawnApproach, layout.spawnApproach);
    }
  });

  test("placeActors seats first delver on spawnApproach and first warden beside exitApproach, never on it (#397)", () => {
    const layout = {
      width: 7,
      height: 5,
      terrain: [
        ...Array(7).fill("wall"),
        "spawn", ...Array(5).fill("floor"), "wall",
        "wall", ...Array(5).fill("floor"), "wall",
        "wall", ...Array(5).fill("floor"), "exit",
        ...Array(7).fill("wall"),
      ],
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
        { id: "delver_1", alignment: "external" },
        { id: "warden_1", alignment: "dungeon" },
      ],
      layout,
      delverCount: 1,
    });
    assert.equal(changed, true);
    assert.deepEqual(actors.find((a) => a.id === "delver_1").position, { x: 1, y: 1 });
    assert.deepEqual(actors.find((a) => a.id === "warden_1").position, { x: 5, y: 2 });
  });
});
