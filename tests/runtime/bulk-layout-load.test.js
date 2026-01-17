const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const { resolve } = require("node:path");
const { runEsm, moduleUrl } = require("../helpers/esm-runner");

const ROOT = resolve(__dirname, "../..");
const WASM_PATH = resolve(ROOT, "build/core-as.wasm");
const CORE_SETUP_MODULE = moduleUrl("packages/runtime/src/runner/core-setup.mjs");

test("runtime bulk layout loading matches per-cell results", (t) => {
  if (!existsSync(WASM_PATH)) {
    t.skip(`Missing WASM at ${WASM_PATH}`);
    return;
  }

  const script = `
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { applySimConfigToCore } from ${JSON.stringify(CORE_SETUP_MODULE)};

const buffer = await readFile(${JSON.stringify(WASM_PATH)});

async function buildCore({ bulk }) {
  const { instance } = await WebAssembly.instantiate(buffer, {
    env: {
      abort(_msg, _file, line, column) {
        throw new Error(\`WASM abort at \${line}:\${column}\`);
      },
    },
  });
  const exports = instance.exports;
  const core = {
    memory: exports.memory,
    configureGrid: exports.configureGrid,
    setTileAt: exports.setTileAt,
    renderBaseCellChar: exports.renderBaseCellChar,
    getMapWidth: exports.getMapWidth,
    getMapHeight: exports.getMapHeight,
  };
  let bulkUsed = false;
  if (bulk) {
    core.prepareTileBuffer = (...args) => {
      bulkUsed = true;
      return exports.prepareTileBuffer(...args);
    };
    core.loadTilesFromBuffer = exports.loadTilesFromBuffer;
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
  await readFile(${JSON.stringify(resolve(ROOT, "tests/fixtures/artifacts/sim-config-artifact-v1-mvp-grid.json"))}, "utf8"),
);

const perCellWrapper = await buildCore({ bulk: false });
const bulkWrapper = await buildCore({ bulk: true });
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
`;

  runEsm(script);
});
