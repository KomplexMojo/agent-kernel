const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const ROOT = resolve(__dirname, "../..");

test("runtime bulk layout loading matches per-cell results", async () => {
  const [{ applySimConfigToCore }, { createCore }] = await Promise.all([
    import("../../packages/runtime/src/runner/core-setup.mjs"),
    import("../../packages/core-ts/src/index.ts"),
  ]);

  function buildCore({ bulk }) {
    const core = createCore();
    let bulkUsed = false;
    if (bulk) {
      const prepareTileBuffer = core.prepareTileBuffer.bind(core);
      core.prepareTileBuffer = (...args) => {
        bulkUsed = true;
        return prepareTileBuffer(...args);
      };
    } else {
      delete core.prepareTileBuffer;
      delete core.loadTilesFromBuffer;
    }
    return { core, bulkUsed: () => bulkUsed };
  }

  function readBaseTiles(core) {
    const width = core.getMapWidth();
    const height = core.getMapHeight();
    const rows = [];
    for (let y = 0; y < height; y += 1) {
      let row = "";
      for (let x = 0; x < width; x += 1) {
        row += String.fromCharCode(core.renderBaseCellChar(x, y));
      }
      rows.push(row);
    }
    return rows;
  }

  const simConfig = JSON.parse(
    readFileSync(resolve(ROOT, "tests/fixtures/artifacts/sim-config-artifact-v1-mvp-grid.json"), "utf8"),
  );

  const perCellWrapper = buildCore({ bulk: false });
  const bulkWrapper = buildCore({ bulk: true });
  const perCellCore = perCellWrapper.core;
  const bulkCore = bulkWrapper.core;

  const perCellResult = applySimConfigToCore(perCellCore, simConfig);
  const bulkResult = applySimConfigToCore(bulkCore, simConfig);
  assert.equal(perCellResult.ok, true);
  assert.equal(bulkResult.ok, true);
  assert.equal(bulkWrapper.bulkUsed(), true);

  const perCellTiles = readBaseTiles(perCellCore);
  const bulkTiles = readBaseTiles(bulkCore);
  assert.deepEqual(bulkTiles, perCellTiles);
});
