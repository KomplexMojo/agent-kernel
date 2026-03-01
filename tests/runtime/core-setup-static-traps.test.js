const test = require("node:test");
const { moduleUrl, runEsm } = require("../helpers/esm-runner");

const modulePath = moduleUrl("packages/runtime/src/runner/core-setup.mjs");

test("applySimConfigToCore arms non-blocking static traps with mana reserve", () => {
  const script = `
import assert from "node:assert/strict";
import { applySimConfigToCore } from ${JSON.stringify(modulePath)};

const armed = [];
const core = {
  configureGrid() { return 0; },
  setTileAt() {},
  armStaticTrapAt(x, y, kind, expression, stacks, manaReserve) {
    armed.push({ x, y, kind, expression, stacks, manaReserve });
    return 1;
  },
};

const simConfig = {
  layout: {
    kind: "grid",
    data: {
      width: 4,
      height: 4,
      tiles: ["....", "....", "....", "...."],
      traps: [
        {
          x: 1,
          y: 1,
          blocking: false,
          affinity: { kind: "earth", expression: "emit", stacks: 3 },
          vitals: { mana: { current: 4, max: 4, regen: 1 } },
        },
        {
          x: 2,
          y: 2,
          blocking: true,
          affinity: { kind: "fire", expression: "push", stacks: 1 },
          vitals: { mana: { current: 2, max: 2, regen: 0 } },
        },
      ],
    },
  },
};

const result = applySimConfigToCore(core, simConfig);
assert.equal(result.ok, true);
assert.equal(armed.length, 1);
assert.deepEqual(armed[0], { x: 1, y: 1, kind: 3, expression: 3, stacks: 3, manaReserve: 4 });
`;
  runEsm(script);
});
