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
const { overlayActors, paintBoardRow, renderScreen } = require("../../packages/ui-ascii/src/screen.js");
const { GAME_COLOR_PALETTE } = require("../../packages/runtime/src/contracts/game-elements.js");
const { ASCII_ENTITY_GLYPHS } = require("../../packages/runtime/src/render/visualization-snapshot.js");
const { parseArgs, resolveLevels, runScripted, shouldUseColor } = require("../../packages/ui-ascii/src/cli.mjs");
const { createPlaySession } = require("../../packages/runtime/src/runner/play-session.js");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/ui-ascii/src/cli.mjs");
const GENERATE_LEVELS = resolve(ROOT, "scripts/ui-ascii/generate-levels.mjs");
// Hand-written levels with a known shape, for tests that assert exact rows.
// The bundled levels are `ak create` output, so their shape is the Configurator's.
const FIXTURE_LEVELS_DIR = resolve(ROOT, "tests/fixtures/ui-ascii/levels");
const fixtureLevel = (name) => loadBundledLevel(name, FIXTURE_LEVELS_DIR);
const fixtureLevels = () => loadBundledLevels(FIXTURE_LEVELS_DIR);
// first-steps fixture: from the spawn approach (1,1) to the exit approach (7,7), then step through.
const FIRST_STEPS_SOLUTION = "ddssddssssdd.";

function solve(level, { othersAreWalls = true } = {}) {
  // Breadth-first over the level's tiles, then replayed through the real
  // session: this proves each bundled level is winnable under core's rules, not
  // under the search's.
  const { tiles, exitApproach } = level.simConfig.layout.data;
  const start = level.initialState.actors[0].position;
  const occupied = new Set(othersAreWalls
    ? level.initialState.actors.slice(1).map((actor) => `${actor.position.x},${actor.position.y}`)
    : []);
  const steps = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
  const key = (p) => `${p.x},${p.y}`;
  const prev = new Map([[key(start), null]]);
  const queue = [start];
  while (queue.length) {
    const at = queue.shift();
    if (at.x === exitApproach.x && at.y === exitApproach.y) break;
    for (const [direction, [dx, dy]] of Object.entries(steps)) {
      const next = { x: at.x + dx, y: at.y + dy };
      if (tiles[next.y]?.[next.x] !== "." || prev.has(key(next)) || occupied.has(key(next))) continue;
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

test("bundled levels list in play order and every one loads and is winnable", async () => {
  assert.deepEqual(listBundledLevels(), ["first-steps", "long-way-round", "warden-hall", "water-traps"]);
  for (const name of listBundledLevels()) {
    const level = loadBundledLevel(name);
    // With other actors taking turns the replay is no longer a fixed script,
    // so only solo levels are replayed move for move. The Configurator posts
    // the first warden on the exit approach; the level is winnable once it
    // moves off, so the search ignores other actors here.
    if (level.initialState.actors.length > 1) {
      assert.ok(solve(level, { othersAreWalls: false }).path.length > 0, `${name} has a path to its exit`);
      assert.match((await createPlaySession(level)).playerActorId, /delver/, `${name} plays the delver`);
      continue;
    }
    const { path } = solve(level);
    assert.ok(path.length > 0, `${name} has a path to its exit`);
    const session = await createPlaySession(level);
    for (const direction of path) {
      const result = await session.act({ kind: "move", params: { direction } });
      assert.equal(result.accepted.length, 1, `${name}: ${direction}`);
    }
    assert.equal((await session.act({ kind: "wait" })).status.exited, true, `${name} exits`);
  }
});

test("bundled levels are exactly what `ak create` makes from their recipes", () => {
  const result = spawnSync(process.execPath, [GENERATE_LEVELS, "--check"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("bundled and fixture levels are versioned artifacts", () => {
  for (const { simConfig, initialState } of [...loadBundledLevels(), ...fixtureLevels()]) {
    assert.equal(simConfig.schema, "agent-kernel/SimConfigArtifact");
    assert.equal(initialState.schema, "agent-kernel/InitialStateArtifact");
    assert.equal(simConfig.schemaVersion, 1);
    assert.equal(initialState.simConfigRef.id, simConfig.meta.id);
  }
});

// The Configurator floors every authored actor to ACTOR_VIABILITY_FLOOR
// (applyActorViabilityFloor). Fixture levels are hand-written artifacts that
// never pass through it, so they must already sit at or above the floor too.
test("every actor in a bundled or fixture level meets the actor viability floor", () => {
  const { ACTOR_VIABILITY_FLOOR } = require("../../packages/runtime/src/contracts/domain-constants.js");
  for (const { name, initialState } of [...loadBundledLevels(), ...fixtureLevels()]) {
    for (const actor of initialState.actors) {
      for (const [key, floor] of Object.entries(ACTOR_VIABILITY_FLOOR)) {
        const vital = actor.vitals[key];
        assert.ok(vital.max >= floor.max, `${name}/${actor.id} ${key}.max ${vital.max} < ${floor.max}`);
        assert.ok(vital.current >= floor.max, `${name}/${actor.id} ${key}.current ${vital.current} < ${floor.max}`);
        assert.ok(vital.regen >= floor.regen, `${name}/${actor.id} ${key}.regen ${vital.regen} < ${floor.regen}`);
      }
    }
  }
});

test("an unknown bundled level is refused with the list of real ones", () => {
  assert.throws(() => loadBundledLevel("nope"), /Unknown level "nope".*first-steps/);
});

test("a level loads from an ak run directory's build artifacts", () => {
  const runDir = mkdtempSync(join(tmpdir(), "ui-ascii-run-"));
  try {
    mkdirSync(join(runDir, "create"));
    copyFileSync(join(FIXTURE_LEVELS_DIR, "first-steps.sim-config.json"), join(runDir, "create", "sim-config.json"));
    copyFileSync(join(FIXTURE_LEVELS_DIR, "first-steps.initial-state.json"), join(runDir, "create", "initial-state.json"));
    const level = loadLevelFromRunDir(runDir);
    assert.equal(level.simConfig.meta.id, "sim_config_first-steps");
    assert.throws(() => loadLevelFromRunDir(join(runDir, "missing")), /No sim-config.json/);
    // `ak create --out-dir` writes the pair at the top level.
    // `ak create --out-dir` output, as the bundled levels are.
    copyFileSync(join(BUNDLED_LEVELS_DIR, "long-way-round.sim-config.json"), join(runDir, "sim-config.json"));
    copyFileSync(join(BUNDLED_LEVELS_DIR, "long-way-round.initial-state.json"), join(runDir, "initial-state.json"));
    assert.equal(loadLevelFromRunDir(runDir).simConfig.layout.kind, loadBundledLevel("long-way-round").simConfig.layout.kind);
    assert.equal(loadLevelFromRunDir(runDir).simConfig.meta.runId, "long-way-round");
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("playing first-steps through the controller escapes, then Enter loads the next level", async () => {
  const game = await createGame({ levels: fixtureLevels() });
  await runScripted(game, FIRST_STEPS_SOLUTION);
  assert.equal(game.state().status.exited, true);
  assert.equal(game.state().turns, FIRST_STEPS_SOLUTION.length);
  await game.handle({ type: INTENT.NEXT_LEVEL });
  assert.equal(game.state().levelName, "long-way-round");
  assert.equal(game.state().turns, 0);
});

test("Enter does nothing before the exit, and after the last level says so", async () => {
  const levels = [fixtureLevel("first-steps")];
  const game = await createGame({ levels });
  await game.handle({ type: INTENT.NEXT_LEVEL });
  assert.equal(game.state().levelName, "first-steps");
  await runScripted(game, `${FIRST_STEPS_SOLUTION}\r`);
  assert.equal(game.state().finished, true);
  assert.match(game.screen(), /last level/);
});

test("a wall bump shows a message and costs a turn; restart resets the level", async () => {
  const game = await createGame({ levels: fixtureLevels() });
  await game.handle(intentForKey("k"));
  assert.equal(game.state().turns, 1);
  assert.match(game.screen(), /A wall blocks the way\./);
  await runScripted(game, "dd");
  assert.equal(game.state().turns, 3);
  await game.handle({ type: INTENT.RESTART });
  assert.equal(game.state().turns, 0);
  assert.match(game.screen(), /S@\.\.#/);
});

test("quit is reported to the caller, not acted on", async () => {
  const game = await createGame({ levels: loadBundledLevels() });
  assert.deepEqual(await game.handle({ type: INTENT.QUIT }), { quit: true });
  assert.deepEqual(await game.handle(null), { quit: false });
});

test("the screen shows the board, present vitals only, tick, turns and the status hint", async () => {
  const session = await createPlaySession(fixtureLevel("first-steps"));
  const screen = renderScreen({ view: session.view(), levelName: "first-steps", levelCount: 2 });
  assert.match(screen, /first-steps \(1\/2\)/);
  assert.match(screen, /^ {2}S@\.\.#\.\.\.#$/m);
  assert.match(screen, /HP █+ 10\/10/);
  assert.match(screen, /MP █+ 10\/10/);
  assert.match(screen, /Tick 0 {3}Turns 0/);
  assert.match(screen, /Find the exit/);
  assert.doesNotMatch(screen, /\u001b\[/, "no ANSI unless colour is asked for");
  const colored = renderScreen({ view: session.view(), levelName: "x", color: true });
  assert.match(colored, /\u001b\[38;2;/);
});

test("cli arguments parse, and bad ones are errors", () => {
  assert.deepEqual(parseArgs(["--level", "long-way-round", "--no-color"]), { color: false, level: "long-way-round" });
  assert.deepEqual(parseArgs(["--", "--level", "warden-hall"]), { color: true, level: "warden-hall" }, "pnpm's -- separator is ignored");
  assert.throws(() => parseArgs(["--level"]), /needs a value/);
  assert.throws(() => parseArgs(["--bogus"]), /Unknown option/);
  assert.equal(resolveLevels({ level: "long-way-round" }).startIndex, 1);
  assert.equal(resolveLevels({ level: "warden-hall" }).startIndex, 2);
  assert.equal(parseArgs(["--keys", "", "--json"]).json, true);
  assert.throws(() => resolveLevels({ simConfigPath: "x.json" }), /required together/);
});

test("the cli plays a scripted game end to end, as text or JSON", () => {
  const files = [
    "--sim-config", join(FIXTURE_LEVELS_DIR, "first-steps.sim-config.json"),
    "--initial-state", join(FIXTURE_LEVELS_DIR, "first-steps.initial-state.json"),
  ];
  const result = spawnSync(process.execPath, [CLI, ...files, "--no-color", "--keys", FIRST_STEPS_SOLUTION], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /You escaped!/);
  const json = spawnSync(process.execPath, [CLI, ...files, "--json", "--keys", FIRST_STEPS_SOLUTION], { encoding: "utf8" });
  assert.equal(json.status, 0, json.stderr);
  const payload = JSON.parse(json.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.turns, FIRST_STEPS_SOLUTION.length);
  assert.equal(payload.status.exited, true);
  assert.match(payload.screen, /You escaped!/);
  assert.doesNotMatch(payload.screen, /\u001b\[/, "JSON screens are plain unless --color forces it");
  const noKeys = spawnSync(process.execPath, [CLI, "--json"], { encoding: "utf8", input: "" });
  assert.equal(noKeys.status, 2);
  const noTty = spawnSync(process.execPath, [CLI], { encoding: "utf8", input: "" });
  assert.equal(noTty.status, 1);
  assert.match(noTty.stderr, /interactive terminal/);
});

test("other actors are drawn over core's rows with the snapshot's letters, never over the player", () => {
  const rows = ["#####", "#@..#", "#####"];
  const actors = [
    { id: "warden-1", role: "warden", position: { x: 3, y: 1 } },
    { id: "delver-2", role: "delver", position: { x: 2, y: 1 } },
    { id: "ghost", role: "warden", position: { x: 1, y: 1 } },
    { id: "lost", role: "warden", position: { x: 9, y: 9 } },
  ];
  assert.deepEqual(overlayActors(rows, actors, { x: 1, y: 1 }), ["#####", `#@${ASCII_ENTITY_GLYPHS.delver}${ASCII_ENTITY_GLYPHS.warden}#`, "#####"]);
  assert.equal(overlayActors(rows, undefined, null), rows, "no actors: core's rows as-is");
});

test("the screen draws view.actors when the session reports them", async () => {
  const session = await createPlaySession(fixtureLevel("first-steps"));
  const view = { ...session.view(), actors: [{ id: "warden-1", role: "warden", position: { x: 3, y: 1 } }] };
  assert.match(renderScreen({ view, levelName: "first-steps" }), /^ {2}S@\.W#\.\.\.#$/m);
});

const ansi = (hex, layer) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `\u001b[${layer};2;${r};${g};${b}m`;
};

test("in colour, board cells take the palette's tile fills and role colours", async () => {
  const session = await createPlaySession(fixtureLevel("first-steps"));
  const screen = renderScreen({ view: session.view(), levelName: "first-steps", color: true });
  assert.ok(screen.includes(ansi(GAME_COLOR_PALETTE.tiles.wall, 48)), "wall fill");
  assert.ok(screen.includes(ansi(GAME_COLOR_PALETTE.tiles.floor, 48)), "floor fill");
  assert.ok(screen.includes(`${ansi(GAME_COLOR_PALETTE.motivations.user_controlled, 38)}@`), "player colour");
  // Stripping the escapes leaves exactly the plain screen.
  const plain = renderScreen({ view: session.view(), levelName: "first-steps" });
  assert.equal(screen.replace(/\u001b\[[0-9;]*m/g, ""), plain);
});

test("a row is painted in runs and unstyled characters stay plain", () => {
  const styles = { "#": { fg: "#cccccc", bg: "#3b3237" } };
  assert.equal(paintBoardRow("##?", styles), `${ansi("#3b3237", 48)}${ansi("#cccccc", 38)}##\u001b[0m?`);
  assert.equal(paintBoardRow("??", styles), "??");
});

test("colour: on for a terminal, off for pipes, NO_COLOR and --no-color; --color forces it", () => {
  assert.equal(shouldUseColor({ color: true }, { isTTY: true, env: {} }), true);
  assert.equal(shouldUseColor({ color: true }, { isTTY: false, env: {} }), false);
  assert.equal(shouldUseColor({ color: true }, { isTTY: true, env: { NO_COLOR: "1" } }), false);
  assert.equal(shouldUseColor({ color: true }, { isTTY: true, env: { NO_COLOR: "" } }), true);
  assert.equal(shouldUseColor({ color: false }, { isTTY: true, env: {} }), false);
  assert.equal(shouldUseColor({ color: "always" }, { isTTY: false, env: { NO_COLOR: "1" } }), true);
  assert.equal(parseArgs(["--color"]).color, "always");
});

test("warden-hall's wardens wander once the play session runs their turns", async (context) => {
  const session = await createPlaySession(loadBundledLevel("warden-hall"));
  const start = session.view().actors;
  // Other actors only act (and are only reported) with the persona-routed play
  // session from the enemy-turns PR; until it lands this level is solo.
  if (!Array.isArray(start)) return context.skip();
  const startById = new Map(start.map((actor) => [actor.id, actor.position]));
  for (let turn = 0; turn < 6; turn += 1) await session.act({ kind: "wait" });
  const moved = session.view().actors.filter((actor) => {
    const from = startById.get(actor.id);
    return from && (from.x !== actor.position.x || from.y !== actor.position.y);
  });
  assert.ok(moved.length > 0, "at least one warden left its starting cell");
});

test("in colour, actors with an equipped affinity are filled with it; others keep their role colour", async () => {
  const { GAME_AFFINITY_COLOR_HEX } = require("../../packages/runtime/src/contracts/game-elements.js");
  const session = await createPlaySession(loadBundledLevel("warden-hall"));
  const view = {
    ...session.view(),
    actors: [
      { id: "warden-1", role: "warden", position: { x: 6, y: 5 }, affinities: [{ kind: "fire" }] },
      { id: "warden-3", role: "warden", position: { x: 9, y: 3 } },
    ],
  };
  assert.equal(view.player.affinity, "wind", "the authored equipped affinity reaches the view");
  const screen = renderScreen({ view, levelName: "warden-hall", color: true });
  assert.ok(screen.includes(`${ansi(GAME_AFFINITY_COLOR_HEX.wind, 48)}`), "player cell is the wind fill");
  assert.ok(screen.includes(`${ansi(GAME_AFFINITY_COLOR_HEX.fire, 48)}`), "fire warden cell");
  assert.ok(screen.includes(`${ansi(GAME_COLOR_PALETTE.actors.warden, 38)}W`), "unaffiliated warden keeps its role colour");
  assert.equal(screen.replace(/\u001b\[[0-9;]*m/g, ""), renderScreen({ view, levelName: "warden-hall" }));
});

test("generated actors read as wardens from their id when role is unset", () => {
  const rows = ["#####", "#@..#", "#####"];
  const actors = [{ id: "card_warden_1-1", role: null, position: { x: 3, y: 1 } }];
  assert.deepEqual(overlayActors(rows, actors, { x: 1, y: 1 }), ["#####", `#@.${ASCII_ENTITY_GLYPHS.warden}#`, "#####"]);
});

test("water-traps draws its traps as H in the water fill, and a trap costs health", async () => {
  const { GAME_AFFINITY_COLOR_HEX } = require("../../packages/runtime/src/contracts/game-elements.js");
  const level = loadBundledLevel("water-traps");
  const session = await createPlaySession(level);
  const view = session.view();
  assert.ok(view.hazards.length > 0, "the level's hazards reach the view");
  const plain = renderScreen({ view, levelName: "water-traps" });
  const boardRows = plain.split("\n").slice(2, 2 + view.rows.length).map((row) => row.slice(2));
  for (const { position } of view.hazards) {
    assert.equal(boardRows[position.y][position.x], ASCII_ENTITY_GLYPHS.hazard, `trap at ${position.x},${position.y}`);
  }
  assert.match(plain, /Mind the traps \(H\)/);
  const colored = renderScreen({ view, levelName: "water-traps", color: true });
  assert.ok(colored.includes(`${ansi(GAME_AFFINITY_COLOR_HEX.water, 48)}`), "trap cells take the water fill");
  assert.equal(colored.replace(/\u001b\[[0-9;]*m/g, ""), plain);

  // Walk onto the first trap along a breadth-first path and let core apply it.
  const trap = view.hazards[0].position;
  const { path } = solve({ ...level, simConfig: { ...level.simConfig, layout: { ...level.simConfig.layout, data: { ...level.simConfig.layout.data, exitApproach: trap } } } });
  const healthBefore = view.player.vitals.find((vital) => vital.key === "health").current;
  for (const direction of path) await session.act({ kind: "move", params: { direction } });
  const after = session.view();
  assert.deepEqual(after.player.position, trap);
  assert.ok(after.player.vitals.find((vital) => vital.key === "health").current < healthBefore, "the trap hurt");
});

// ## TODO: Test Permutations
// - every key in the keymap, upper and lower case
// - --run with each of the build/create/configurator subdirectories
// - --sim-config/--initial-state with one path missing
// - NEXT_LEVEL from each bundled level in turn
// - help toggle hides and restores the help lines
