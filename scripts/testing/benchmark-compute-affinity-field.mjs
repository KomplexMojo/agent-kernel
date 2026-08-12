import { performance } from "node:perf_hooks";

import { createCore } from "../../packages/core-ts/src/index.ts";

const WIDTH = Number(process.env.AK_AFFINITY_BENCH_WIDTH ?? 64);
const HEIGHT = Number(process.env.AK_AFFINITY_BENCH_HEIGHT ?? 64);
const SAMPLES = Number(process.env.AK_AFFINITY_BENCH_SAMPLES ?? 40);
const WARMUP = Number(process.env.AK_AFFINITY_BENCH_WARMUP ?? 8);
const THRESHOLD_MS = Number(process.env.AK_AFFINITY_BENCH_THRESHOLD_MS ?? 50);

function call(fn, ...args) {
  if (typeof fn !== "function") {
    throw new Error("expected callable core export");
  }
  return fn(...args);
}

function configureBenchmarkCore() {
  const core = createCore();
  call(core.configureGrid, WIDTH, HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      call(core.setTileAt, x, y, 1);
    }
  }

  call(core.clearActorPlacements);
  for (let i = 0; i < 24; i += 1) {
    const x = 2 + ((i * 11) % Math.max(1, WIDTH - 4));
    const y = 2 + ((i * 7) % Math.max(1, HEIGHT - 4));
    call(core.addActorPlacement, i + 1, x, y);
  }
  call(core.applyActorPlacements);

  for (let i = 0; i < 24; i += 1) {
    const kind = (i % 10) + 1;
    const expression = 3;
    const stacks = (i % 3) + 1;
    call(core.setMotivatedActorAffinity, i, kind, expression, stacks);
  }

  for (let i = 0; i < 24; i += 1) {
    const x = 1 + ((i * 13) % Math.max(1, WIDTH - 2));
    const y = 1 + ((i * 5) % Math.max(1, HEIGHT - 2));
    const kind = ((i + 3) % 10) + 1;
    call(core.armStaticHazardAt, x, y, kind, 3, (i % 3) + 1, 5);
  }

  return core;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

const core = configureBenchmarkCore();
const timings = [];

for (let i = 0; i < WARMUP + SAMPLES; i += 1) {
  const start = performance.now();
  const projected = call(core.computeAffinityField);
  const elapsed = performance.now() - start;
  if (projected <= 0) {
    throw new Error(`computeAffinityField projected ${projected} sources`);
  }
  if (i >= WARMUP) {
    timings.push(elapsed);
  }
}

const medianMs = median(timings);
const maxMs = Math.max(...timings);
const minMs = Math.min(...timings);
const passed = medianMs <= THRESHOLD_MS;

console.log(JSON.stringify({
  benchmark: "computeAffinityField",
  width: WIDTH,
  height: HEIGHT,
  samples: SAMPLES,
  warmup: WARMUP,
  thresholdMs: THRESHOLD_MS,
  medianMs: Number(medianMs.toFixed(3)),
  minMs: Number(minMs.toFixed(3)),
  maxMs: Number(maxMs.toFixed(3)),
  passed,
}, null, 2));

if (!passed) {
  process.exitCode = 1;
}
