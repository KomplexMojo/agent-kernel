/**
 * ui-ascii is terminal IO over the runtime play session. Keys map to intents,
 * the controller turns intents into session calls, and the screen lays out what
 * the session returns. Everything here runs without a terminal.
 */
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, mkdirSync, copyFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const { intentForKey, splitKeys, INTENT } = require("../../packages/ui-ascii/src/keymap.js");
const {
  BUNDLED_LEVELS_DIR,
  listBundledLevels,
  loadBundledLevel,
  loadBundledLevels,
  loadLevelFromRunDir,
} = require("../../packages/ui-ascii/src/levels.js");
const { createGame } = require("../../packages/ui-ascii/src/game.js");
const { renderScreen } = require("../../packages/ui-ascii/src/screen.js");
const { parseArgs, resolveLevels, runScripted } = require("../../packages/ui-ascii/src/cli.mjs");
const { createPlaySession, PLAY_STATUS } = require("../../packages/runtime/src/runner/play-session.js");

const CLI = resolve(__dirname, "../../packages/ui-ascii/src/cli.mjs");
// first-steps: from the spawn approach (1,1) to the exit approach (7,7), then step through.
const FIRST_STEPS_SOLUTION = "ddssddssssdd.";

function solve(levelName) {
  // Breadth-first over the level's tiles, then replayed through the real
  // session: this proves each bundled level is winnable under core's rules, not
  // under the search's.
  const level = loadBundledLevel(levelName);
  const { tiles, exitApproach } = level.simConfig.layout.data;
  const start = level.initialState.actors[0].position;
  const steps = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
  const key = (p) => `${p.x},${p.y}`;
  const prev = new Map([[key(start), null]]);
  const queue = [start];
  while (queue.length) {
    const at = queue.shift();
    if (at.x === exitApproach.x && at.y === exitApproach.y) break;
    for (const [direction, [dx, dy]] of Object.entries(steps)) {
      const next = { x: at.x + dx, y: at.y + dy };
      if (tiles[next.y]?.[next.x] !== "." || prev.has(key(next))) continue;
      prev.set(key(next), { at, direction });
      queue.push(next);
    }
  }
  const path = [];
  for (let link = prev.get(key(exitApproach)); link; link = prev.get(key(link.at))) path.unshift(link.direction);
  return { level, path };
}

test("keys map to intents: arrows, WASD, vi keys, diagonals, wait, quit", () => {
  assert.deepEqual(intentForKey("\u001b[A"), { type: INTENT.MOVE, direction: "north" });
  assert.deepEqual(intentForKey("a"), { type: INTENT.MOVE, direction: "west" });
  assert.deepEqual(intentForKey("J"), { type: INTENT.MOVE, direction: "south" });
  assert.deepEqual(intentForKey("n"), { type: INTENT.MOVE, direction: "southeast" });
  assert.deepEqual(intentForKey("."), { type: INTENT.WAIT });
  assert.deepEqual(intentForKey("\u0003"), { type: INTENT.QUIT });
  assert.deepEqual(intentForKey("\r"), { type: INTENT.NEXT_LEVEL });
  assert.equal(intentForKey("z"), null);
  assert.equal(intentForKey(""), null);
});

test("a chunk of input splits into keys with escape sequences kept whole", () => {
  assert.deepEqual(splitKeys("d\u001b[Bq"), ["d", "\u001b[B", "q"]);
  assert.deepEqual(splitKeys("\u001b"), ["\u001b"]);
});

test("bundled levels list in play order and every one loads and is winnable", () => {
  assert.deepEqual(listBundledLevels(), ["first-steps", "long-way-round"]);
  for (const name of listBundledLevels()) {
    const { level, path } = solve(name);
    assert.ok(path.length > 0, `${name} has a path to its exit`);
    const session = createPlaySession(level);
    for (const direction of path) {
      assert.equal(session.move(direction).accepted, true, `${name}: ${direction}`);
    }
    assert.equal(session.wait().status, PLAY_STATUS.ESCAPED, `${name} escapes`);
  }
});

test("bundled levels are versioned artifacts", () => {
  for (const { simConfig, initialState } of loadBundledLevels()) {
    assert.equal(simConfig.schema, "agent-kernel/SimConfigArtifact");
    assert.equal(initialState.schema, "agent-kernel/InitialStateArtifact");
    assert.equal(simConfig.schemaVersion, 1);
    assert.equal(initialState.simConfigRef.id, simConfig.meta.id);
  }
});

test("an unknown bundled level is refused with the list of real ones", () => {
  assert.throws(() => loadBundledLevel("nope"), /Unknown level "nope".*first-steps/);
});

test("a level loads from an ak run directory's build artifacts", () => {
  const runDir = mkdtempSync(join(tmpdir(), "ui-ascii-run-"));
  try {
    mkdirSync(join(runDir, "create"));
    copyFileSync(join(BUNDLED_LEVELS_DIR, "first-steps.sim-config.json"), join(runDir, "create", "sim-config.json"));
    copyFileSync(join(BUNDLED_LEVELS_DIR, "first-steps.initial-state.json"), join(runDir, "create", "initial-state.json"));
    const level = loadLevelFromRunDir(runDir);
    assert.equal(level.simConfig.meta.id, "sim_config_first-steps");
    assert.throws(() => loadLevelFromRunDir(join(runDir, "missing")), /No sim-config.json/);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("playing first-steps through the controller escapes, then Enter loads the next level", () => {
  const game = createGame({ levels: loadBundledLevels() });
  runScripted(game, FIRST_STEPS_SOLUTION);
  assert.equal(game.state().status, PLAY_STATUS.ESCAPED);
  assert.equal(game.state().moves, FIRST_STEPS_SOLUTION.length);
  game.handle({ type: INTENT.NEXT_LEVEL });
  assert.equal(game.state().levelName, "long-way-round");
  assert.equal(game.state().moves, 0);
});

test("Enter does nothing before the exit, and after the last level says so", () => {
  const levels = [loadBundledLevel("first-steps")];
  const game = createGame({ levels });
  game.handle({ type: INTENT.NEXT_LEVEL });
  assert.equal(game.state().levelName, "first-steps");
  runScripted(game, `${FIRST_STEPS_SOLUTION}\r`);
  assert.equal(game.state().finished, true);
  assert.match(game.screen(), /last level/);
});

test("a wall bump shows a message and costs no move; restart resets the level", () => {
  const game = createGame({ levels: loadBundledLevels() });
  game.handle(intentForKey("k"));
  assert.equal(game.state().moves, 0);
  assert.match(game.screen(), /A wall blocks the way\./);
  runScripted(game, "dd");
  assert.equal(game.state().moves, 2);
  game.handle({ type: INTENT.RESTART });
  assert.equal(game.state().moves, 0);
  assert.match(game.screen(), /S@\.\.#/);
});

test("quit is reported to the caller, not acted on", () => {
  const game = createGame({ levels: loadBundledLevels() });
  assert.deepEqual(game.handle({ type: INTENT.QUIT }), { quit: true });
  assert.deepEqual(game.handle(null), { quit: false });
});

test("the screen shows the board, present vitals only, tick, moves and the status hint", () => {
  const session = createPlaySession(loadBundledLevel("first-steps"));
  const screen = renderScreen({ view: session.view(), levelName: "first-steps", levelCount: 2 });
  assert.match(screen, /first-steps \(1\/2\)/);
  assert.match(screen, /^ {2}S@\.\.#\.\.\.#$/m);
  assert.match(screen, /HP █+ 10\/10/);
  assert.doesNotMatch(screen, /MP /, "a 0/0 mana pool is not drawn");
  assert.match(screen, /Tick 0 {3}Moves 0/);
  assert.match(screen, /Find the exit/);
  assert.doesNotMatch(screen, /\u001b\[/, "no ANSI unless colour is asked for");
  const colored = renderScreen({ view: session.view(), levelName: "x", color: true });
  assert.match(colored, /\u001b\[38;2;/);
});

test("cli arguments parse, and bad ones are errors", () => {
  assert.deepEqual(parseArgs(["--level", "long-way-round", "--no-color"]), { color: false, level: "long-way-round" });
  assert.throws(() => parseArgs(["--level"]), /needs a value/);
  assert.throws(() => parseArgs(["--bogus"]), /Unknown option/);
  assert.equal(resolveLevels({ level: "long-way-round" }).startIndex, 1);
  assert.throws(() => resolveLevels({ simConfigPath: "x.json" }), /required together/);
});

test("the cli plays a scripted game end to end", () => {
  const result = spawnSync(process.execPath, [CLI, "--no-color", "--keys", FIRST_STEPS_SOLUTION], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /You escaped!/);
  const noTty = spawnSync(process.execPath, [CLI], { encoding: "utf8", input: "" });
  assert.equal(noTty.status, 1);
  assert.match(noTty.stderr, /interactive terminal/);
});

// ## TODO: Test Permutations
// - every key in the keymap, upper and lower case
// - --run with each of the build/create/configurator subdirectories
// - --sim-config/--initial-state with one path missing
// - NEXT_LEVEL from each bundled level in turn
// - help toggle hides and restores the help lines
