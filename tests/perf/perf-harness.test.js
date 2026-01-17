const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const { readFile } = require("node:fs/promises");
const { resolve } = require("node:path");
const os = require("node:os");
const { performance } = require("node:perf_hooks");
const { generateTierActors, generateTierLayout } = require("../helpers/tier-generators");

const ROOT = resolve(__dirname, "../..");
const WASM_PATH = resolve(ROOT, "build/core-as.wasm");

const PERF_ENABLED = process.env.AK_PERF === "1" || process.env.AK_PERF === "true";
const PERF_USE_GENERATORS = process.env.AK_PERF_GENERATE === "1" || process.env.AK_PERF_GENERATE === "true";

const BYTES_PER_CELL_ESTIMATE = 64;
const DEFAULT_LOAD_BUDGET_MS = 500;
const DEFAULT_MIN_DIM = 10;
const DEFAULT_MAX_DIM = 1000;
const DEFAULT_ACTOR_SCALE = 2000;
const DEFAULT_TICKS = 100;
const DEFAULT_GENERATOR_SEED = 1337;

const TILE_CHAR_TO_CODE = Object.freeze({
  "#": 0,
  ".": 1,
  S: 2,
  E: 3,
  B: 4,
});

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function measureTicks(core, ticks) {
  const start = performance.now();
  for (let i = 0; i < ticks; i += 1) {
    core.applyAction(1, 1);
    core.clearEffects();
  }
  const elapsed = performance.now() - start;
  const perSecond = elapsed > 0 ? ticks / (elapsed / 1000) : 0;
  return { elapsed, perSecond };
}

test(
  "perf harness probes grid sizes and reports headless metrics",
  { skip: !PERF_ENABLED && "Set AK_PERF=1 to run perf harness" },
  async (t) => {
    if (!existsSync(WASM_PATH)) {
      t.skip(`Missing WASM at ${WASM_PATH}`);
      return;
    }

    const buffer = await readFile(WASM_PATH);
    const { instance } = await WebAssembly.instantiate(buffer, {
      env: {
        abort(_msg, _file, line, column) {
          throw new Error(`WASM abort at ${line}:${column}`);
        },
      },
    });
    const exports = instance.exports;
    const core = {
      init: exports.init,
      configureGrid: exports.configureGrid,
      prepareTileBuffer: exports.prepareTileBuffer,
      loadTilesFromBuffer: exports.loadTilesFromBuffer,
      memory: exports.memory,
      setTileAt: exports.setTileAt,
      clearActorPlacements: exports.clearActorPlacements,
      addActorPlacement: exports.addActorPlacement,
      validateActorPlacement: exports.validateActorPlacement,
      applyActorPlacements: exports.applyActorPlacements,
      getMotivatedActorCount: exports.getMotivatedActorCount,
      getMotivatedActorXByIndex: exports.getMotivatedActorXByIndex,
      getMotivatedActorYByIndex: exports.getMotivatedActorYByIndex,
      applyAction: exports.applyAction,
      clearEffects: exports.clearEffects,
    };

    if (typeof core.configureGrid !== "function" || typeof core.applyAction !== "function") {
      throw new Error("Perf harness requires core grid configuration and applyAction exports.");
    }

    core.init(0);

    const totalMem = os.totalmem();
    const memBudgetMb = envNumber("AK_PERF_MEM_BUDGET_MB", Math.floor((totalMem / 1024 / 1024) * 0.05));
    const maxCellsByMem = Math.max(
      DEFAULT_MIN_DIM * DEFAULT_MIN_DIM,
      Math.floor((memBudgetMb * 1024 * 1024) / BYTES_PER_CELL_ESTIMATE)
    );
    const maxDimByMem = Math.max(DEFAULT_MIN_DIM, Math.floor(Math.sqrt(maxCellsByMem)));
    const maxDimEnv = envNumber("AK_PERF_MAX_DIM", DEFAULT_MAX_DIM);
    const minDimEnv = envNumber("AK_PERF_MIN_DIM", DEFAULT_MIN_DIM);
    const loadBudgetMs = envNumber("AK_PERF_LOAD_BUDGET_MS", DEFAULT_LOAD_BUDGET_MS);
    const actorScale = envNumber("AK_PERF_ACTOR_SCALE", DEFAULT_ACTOR_SCALE);
    const generatorSeed = envNumber("AK_PERF_GENERATOR_SEED", DEFAULT_GENERATOR_SEED);
    const layoutProfile = process.env.AK_PERF_LAYOUT_PROFILE || "rectangular";

    const maxDim = Math.max(minDimEnv, Math.min(maxDimByMem, maxDimEnv));
    const minDim = Math.max(DEFAULT_MIN_DIM, Math.min(minDimEnv, maxDim));

    const supportsBulk = typeof core.prepareTileBuffer === "function"
      && typeof core.loadTilesFromBuffer === "function"
      && core.memory;

    function tileCode(char) {
      if (!char) return TILE_CHAR_TO_CODE["#"];
      return TILE_CHAR_TO_CODE[char] ?? TILE_CHAR_TO_CODE["#"];
    }

    function loadTiles(dim, layout) {
      const total = dim * dim;
      if (supportsBulk) {
        const ptr = core.prepareTileBuffer(total);
        if (!ptr || !core.memory?.buffer) {
          return { ok: false, error: "missing_buffer" };
        }
        const view = new Uint8Array(core.memory.buffer, ptr, total);
        if (!layout?.tiles) {
          view.fill(1);
        } else {
          let offset = 0;
          for (let y = 0; y < dim; y += 1) {
            const row = layout.tiles[y] || "";
            for (let x = 0; x < dim; x += 1) {
              view[offset] = tileCode(row[x]);
              offset += 1;
            }
          }
        }
        const loadError = core.loadTilesFromBuffer(total);
        if (Number.isFinite(loadError) && loadError !== 0) {
          return { ok: false, error: loadError };
        }
        return { ok: true };
      }

      for (let y = 0; y < dim; y += 1) {
        for (let x = 0; x < dim; x += 1) {
          if (!layout?.tiles) {
            core.setTileAt(x, y, 1);
            continue;
          }
          const row = layout.tiles[y] || "";
          core.setTileAt(x, y, tileCode(row[x]));
        }
      }
      return { ok: true };
    }

    function computeActorCount(dim) {
      const total = dim * dim;
      return Math.max(1, Math.min(Math.floor(total / actorScale), 20000));
    }

    async function buildActorPositions(dim, actorCount) {
      if (!PERF_USE_GENERATORS) {
        const positions = [];
        for (let i = 0; i < actorCount; i += 1) {
          positions.push({ x: i % dim, y: Math.floor(i / dim) });
        }
        return { ok: true, positions };
      }
      const generated = await generateTierActors({
        tier: 6,
        width: dim,
        height: dim,
        count: actorCount,
        seed: generatorSeed + dim,
        idPrefix: "perf_actor",
      });
      if (!generated.ok) {
        return { ok: false, error: generated.errors?.[0]?.code || "actor_generator_failed" };
      }
      return { ok: true, positions: generated.actors.map((actor) => actor.position) };
    }

    async function placeActors(dim, actorCount) {
      const placements = await buildActorPositions(dim, actorCount);
      if (!placements.ok) {
        return { ok: false, error: placements.error };
      }
      core.clearActorPlacements();
      for (let i = 0; i < placements.positions.length; i += 1) {
        const { x, y } = placements.positions[i];
        core.addActorPlacement(i + 1, x, y);
      }
      const placementError = core.validateActorPlacement();
      if (Number.isFinite(placementError) && placementError !== 0) {
        return { ok: false, error: placementError };
      }
      const applyError = core.applyActorPlacements();
      if (Number.isFinite(applyError) && applyError !== 0) {
        return { ok: false, error: applyError };
      }
      return { ok: true, actorCount: placements.positions.length };
    }

    async function attempt(dim) {
      const start = performance.now();
      const error = core.configureGrid(dim, dim);
      if (Number.isFinite(error) && error !== 0) {
        return { ok: false, error };
      }
      let layout = null;
      if (PERF_USE_GENERATORS) {
        const layoutResult = await generateTierLayout({
          tier: 6,
          width: dim,
          height: dim,
          seed: generatorSeed + dim,
          profile: layoutProfile,
        });
        if (!layoutResult.ok) {
          return { ok: false, error: "layout_generator_failed" };
        }
        layout = layoutResult.value;
      }
      const tileResult = loadTiles(dim, layout);
      if (!tileResult.ok) {
        return { ok: false, error: tileResult.error };
      }
      const actorCount = computeActorCount(dim);
      const placement = await placeActors(dim, actorCount);
      if (!placement.ok) {
        return { ok: false, error: placement.error };
      }
      const loadMs = performance.now() - start;
      return { ok: true, loadMs, actorCount: placement.actorCount };
    }

    let low = minDim;
    let high = maxDim;
    let best = null;
    for (let i = 0; i < 8 && low <= high; i += 1) {
      const mid = Math.floor((low + high) / 2);
      const result = await attempt(mid);
      if (result.ok && result.loadMs <= loadBudgetMs) {
        best = { dim: mid, ...result };
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    if (!best) {
      best = { dim: minDim, ...(await attempt(minDim)) };
    }
    assert.ok(best.ok, `Perf harness failed to load grid: ${best.error ?? "unknown"}`);

    const actorCount = core.getMotivatedActorCount();
    assert.equal(actorCount, best.actorCount);
    if (actorCount > 0) {
      assert.deepEqual(
        { x: core.getMotivatedActorXByIndex(0), y: core.getMotivatedActorYByIndex(0) },
        { x: 0, y: 0 },
      );
      const last = actorCount - 1;
      assert.deepEqual(
        { x: core.getMotivatedActorXByIndex(last), y: core.getMotivatedActorYByIndex(last) },
        { x: last % best.dim, y: Math.floor(last / best.dim) },
      );
    }

    const ticks = envNumber("AK_PERF_TICKS", DEFAULT_TICKS);
    const tickMetrics = measureTicks(core, ticks);
    const heapMb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    const wasmBytes = core.memory?.buffer?.byteLength ?? 0;

    const metrics = {
      dim: best.dim,
      cells: best.dim * best.dim,
      actors: actorCount,
      loadMs: Math.round(best.loadMs),
      tickMs: Math.round(tickMetrics.elapsed),
      ticksPerSecond: Math.round(tickMetrics.perSecond),
      heapMb,
      wasmBytes,
      bulk: supportsBulk,
    };

    if (process.env.AK_PERF_LOG !== "0") {
      console.log("perf", metrics);
    }
    assert.ok(metrics.cells > 0);
  }
);
