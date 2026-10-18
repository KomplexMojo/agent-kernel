/**
 * `--watch`: ui-ascii shows a run `ak run` recorded, with the game's own screen.
 * The run viewer (runtime) decides what is on the board at a tick; ui-ascii only
 * keeps the tick cursor, finds the run's files and lays out the screen.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, test } from "vitest";
import { createPlaybackRuntime, createRuntimeCore } from "../../packages/runtime/src/runner/core-facade.js";
import { loadBundledLevel, loadRunFromDir } from "../../packages/ui-ascii/src/levels.js";
import { WATCH_INTENT, watchIntentForKey } from "../../packages/ui-ascii/src/keymap.js";
import { createWatch } from "../../packages/ui-ascii/src/watch.js";
import { parseArgs } from "../../packages/ui-ascii/src/cli.mjs";

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/ui-ascii/src/cli.mjs");
const level = loadBundledLevel("warden-hall", resolve(ROOT, "tests/fixtures/ui-ascii/levels"));
const TICKS = 4;
let dir;
let frames;

beforeAll(async () => {
  const runtime = createPlaybackRuntime({ core: createRuntimeCore(), clock: () => "2026-10-13T00:00:00.000Z" });
  await runtime.init({ seed: 0, simConfig: level.simConfig, initialState: level.initialState });
  for (let i = 0; i < TICKS; i += 1) await runtime.step();
  frames = runtime.getTickFrames();
  dir = mkdtempSync(join(tmpdir(), "ui-ascii-watch-"));
  // `artifacts/runs/<id>` layout: the build under create/, the run under run/.
  mkdirSync(join(dir, "create"));
  mkdirSync(join(dir, "run"));
  writeFileSync(join(dir, "create", "sim-config.json"), JSON.stringify(level.simConfig));
  writeFileSync(join(dir, "create", "initial-state.json"), JSON.stringify(level.initialState));
  writeFileSync(join(dir, "run", "tick-frames.json"), JSON.stringify(frames));
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("watch keys step, jump and quit; play keys mean nothing here", () => {
  assert.deepEqual(watchIntentForKey("."), { type: WATCH_INTENT.NEXT });
  assert.deepEqual(watchIntentForKey("\u001b[C"), { type: WATCH_INTENT.NEXT });
  assert.deepEqual(watchIntentForKey(","), { type: WATCH_INTENT.PREVIOUS });
  assert.deepEqual(watchIntentForKey("\u001b[D"), { type: WATCH_INTENT.PREVIOUS });
  assert.deepEqual(watchIntentForKey("["), { type: WATCH_INTENT.FIRST });
  assert.deepEqual(watchIntentForKey("]"), { type: WATCH_INTENT.LAST });
  assert.deepEqual(watchIntentForKey("q"), { type: WATCH_INTENT.QUIT });
  assert.equal(watchIntentForKey("i"), null);
});

test("a run loads from the run/ + create/ layout and from an ak run bundle", () => {
  const split = loadRunFromDir(dir);
  assert.equal(split.frames.length, frames.length);
  assert.equal(split.simConfig.meta.id, level.simConfig.meta.id);

  const flat = mkdtempSync(join(tmpdir(), "ui-ascii-watch-flat-"));
  try {
    // `ak run --out-dir`: tick-frames.json beside a bundle that carries the level.
    writeFileSync(join(flat, "tick-frames.json"), JSON.stringify(frames));
    writeFileSync(join(flat, "bundle.json"), JSON.stringify({ artifacts: [level.simConfig, level.initialState] }));
    const run = loadRunFromDir(flat);
    assert.equal(run.initialState.meta.id, level.initialState.meta.id);
    assert.equal(run.frames.length, frames.length);
  } finally {
    rmSync(flat, { recursive: true, force: true });
  }
  assert.throws(() => loadRunFromDir(join(dir, "create")), /No recorded run/);
});

test("the cursor stays inside the run, and each tick draws that tick", () => {
  const watch = createWatch({ run: loadRunFromDir(dir) });
  assert.deepEqual([watch.state().tick, watch.state().maxTick], [0, TICKS]);
  const start = watch.screen();
  watch.handle({ type: WATCH_INTENT.PREVIOUS });
  assert.equal(watch.state().tick, 0);
  watch.handle({ type: WATCH_INTENT.LAST });
  assert.equal(watch.state().tick, TICKS);
  watch.handle({ type: WATCH_INTENT.NEXT });
  assert.equal(watch.state().tick, TICKS);
  assert.match(watch.screen(), new RegExp(`Tick ${TICKS} of ${TICKS}`));
  assert.match(watch.screen(), /End of the recorded run/);
  watch.handle({ type: WATCH_INTENT.FIRST });
  assert.equal(watch.screen(), start);
  assert.deepEqual(watch.handle({ type: WATCH_INTENT.QUIT }), { quit: true });
});

test("the watch screen is the game's screen: wardens drawn, no fog, no play hints", () => {
  const screen = createWatch({ run: loadRunFromDir(dir) }).screen();
  assert.match(screen, /^Deepward run — /);
  assert.match(screen, /W/);
  assert.doesNotMatch(screen, /\?\?\?/);
  assert.doesNotMatch(screen, /press i/);
  assert.match(screen, /Next tick/);
});

test("a tick outside the run is refused", () => {
  assert.throws(() => createWatch({ run: loadRunFromDir(dir), tick: TICKS + 1 }), /--tick must be from 0 to 4/);
});

test("the cli watches a run as text or JSON, and --watch needs --run", () => {
  assert.equal(parseArgs(["--watch", "--tick", "2"]).tick, 2);
  assert.throws(() => parseArgs(["--tick", "two"]), /whole number/);
  const json = spawnSync(process.execPath, [CLI, "--run", dir, "--watch", "--tick", "1", "--keys", ".", "--json", "--no-help"], { encoding: "utf8" });
  assert.equal(json.status, 0, json.stderr);
  const result = JSON.parse(json.stdout);
  assert.equal(result.tick, 2);
  assert.equal(result.maxTick, TICKS);
  assert.doesNotMatch(result.screen, /Next tick/, "--no-help hides the key help");
  const bare = spawnSync(process.execPath, [CLI, "--watch"], { encoding: "utf8" });
  assert.equal(bare.status, 2);
  assert.match(bare.stderr, /--watch needs --run/);
  const tickAlone = spawnSync(process.execPath, [CLI, "--tick", "1"], { encoding: "utf8" });
  assert.equal(tickAlone.status, 2);
  assert.match(tickAlone.stderr, /--tick needs --watch/);
});

// ## TODO: Test Permutations
// - a run whose followed actor exits mid-run: the status line says it left
// - colour in watch mode (--color): actors take their affinity fills
// - a run directory holding only bundle.json with tickFrames (no tick-frames.json)
