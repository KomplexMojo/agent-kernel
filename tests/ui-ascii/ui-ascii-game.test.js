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
const { hudLine, overlayActors, paintBoardRow, renderScreen, xterm256Index } = require("../../packages/ui-ascii/src/screen.js");
const { GAME_COLOR_PALETTE } = require("../../packages/runtime/src/contracts/game-elements.js");
const { ASCII_ENTITY_GLYPHS } = require("../../packages/runtime/src/render/visualization-snapshot.js");
const { colorDepth, parseArgs, resolveColor, resolveLevels, runScripted, shouldUseColor } = require("../../packages/ui-ascii/src/cli.mjs");
const { createPlaySession } = require("../../packages/runtime/src/runner/play-session.js");
const { buildUnifiedLevel, viableVitals } = require("../fixtures/ui-ascii/unified-level.mjs");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/ui-ascii/src/cli.mjs");
const GENERATE_LEVELS = resolve(ROOT, "scripts/ui-ascii/generate-levels.mjs");
// Hand-written levels with a known shape, for tests that assert exact rows.
// The bundled levels are `ak create` output, so their shape is the Configurator's.
const FIXTURE_LEVELS_DIR = resolve(ROOT, "tests/fixtures/ui-ascii/levels");
const fixtureLevel = (name) => loadBundledLevel(name, FIXTURE_LEVELS_DIR);
const fixtureLevels = () => loadBundledLevels(FIXTURE_LEVELS_DIR);
// first-steps fixture: from the spawn approach (1,1) onto the exit (8,7), then wait out the dwell.
// Stamina only recovers on a turn without a move (#273): the default pool (2, regen 2) walks two
// steps, then rests one turn.
const FIRST_STEPS_SOLUTION = "dd.ss.dd.ss.ss.dd.d.";

/** Move along `path`, resting a turn first whenever the player cannot pay for the step (#273). */
async function walk(session, path, onMove = () => {}) {
  for (const direction of path) {
    for (let waits = 0; (session.view().player.vitals.find((vital) => vital.key === "stamina")?.current ?? 0) < 1; waits += 1) {
      // A defeated player never recovers stamina, nor does one a field drains faster than it
      // regenerates: fail rather than wait forever.
      assert.equal((await session.act({ kind: "wait" })).status.defeated, false, "the player was defeated");
      assert.ok(waits < 50, `the player's stamina never came back at ${JSON.stringify(session.view().player.position)}`);
    }
    onMove(await session.act({ kind: "move", params: { direction } }), direction);
  }
}

/** The actor the play session seats as the player: its `user_controlled` delver. */
function playerOf(level) {
  return level.initialState.actors.find((actor) => actor.motivations.includes("user_controlled"))
    ?? level.initialState.actors.find((actor) => level.initialState.presentation[actor.id].category === "delver");
}

function solve(level, { othersAreWalls = true, target } = {}) {
  // Breadth-first over the level's terrain, then replayed through the real
  // session: this proves each bundled level is winnable under core's rules, not
  // under the search's. The goal is the exit terrain unless a target is given.
  const { width, height, terrain } = level.simConfig.layout.data;
  const at = (p) => (p.x < 0 || p.y < 0 || p.x >= width || p.y >= height ? "wall" : terrain[p.y * width + p.x]);
  const player = playerOf(level);
  const start = player.position;
  let goal = target;
  if (!goal) {
    const index = terrain.indexOf("exit");
    goal = { x: index % width, y: Math.trunc(index / width) };
  }
  // Traps are passable (a destroyable trap does not block a route), but a sensible
  // player walks round them rather than through them, so the search does too. Where the
  // level allows it the search also keeps out of each trap's reach (#370: traps are seated
  // apart now, so their fields no longer cancel or destroy each other on tick 1, and one
  // that drains stamina faster than it comes back pins a player who stops beside it).
  const isTrap = (actor) => level.initialState.presentation?.[actor.id]?.category === "hazard";
  const others = othersAreWalls
    ? level.initialState.actors.filter((actor) => actor.id !== player.id && (actor.capabilities.blocksMovement || isTrap(actor)))
    : [];
  const occupied = new Set(others.map((actor) => `${actor.position.x},${actor.position.y}`));
  occupied.delete(`${goal.x},${goal.y}`); // a trap that is the goal is walked onto
  const reach = (actor) => Math.max(0, ...(actor.affinities || []).map((entry) => entry.stacks ?? 1));
  const inReach = (p) => others.some((actor) => isTrap(actor)
    && !(actor.position.x === goal.x && actor.position.y === goal.y)
    && Math.max(Math.abs(actor.position.x - p.x), Math.abs(actor.position.y - p.y)) <= reach(actor));
  const steps = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
  const key = (p) => `${p.x},${p.y}`;
  // Fewest steps inside a trap's reach first, then fewest steps (a two-cost breadth-first search).
  const prev = new Map([[key(start), null]]);
  const cost = new Map([[key(start), [0, 0]]]);
  const better = (left, right) => !right || left[0] < right[0] || (left[0] === right[0] && left[1] < right[1]);
  const queue = [start];
  while (queue.length) {
    queue.sort((left, right) => (better(cost.get(key(left)), cost.get(key(right))) ? -1 : 1));
    const here = queue.shift();
    if (here.x === goal.x && here.y === goal.y) break;
    const [exposed, length] = cost.get(key(here));
    for (const [direction, [dx, dy]] of Object.entries(steps)) {
      const next = { x: here.x + dx, y: here.y + dy };
      if (!["floor", "exit"].includes(at(next)) || occupied.has(key(next))) continue;
      const nextCost = [exposed + (inReach(next) ? 1 : 0), length + 1];
      if (!better(nextCost, cost.get(key(next)))) continue;
      if (!cost.has(key(next))) queue.push(next);
      cost.set(key(next), nextCost);
      prev.set(key(next), { at: here, direction });
    }
  }
  const path = [];
  for (let link = prev.get(key(goal)); link; link = prev.get(key(link.at))) path.unshift(link.direction);
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
  assert.deepEqual(listBundledLevels(), ["first-steps", "long-way-round", "trap-rooms", "warden-hall"]);
  for (const name of listBundledLevels()) {
    const level = loadBundledLevel(name);
    // With other actors taking turns the replay is no longer a fixed script,
    // so only levels where nothing else moves are replayed move for move. The
    // Configurator posts the first warden on the exit approach; the level is
    // winnable once it moves off, so the search ignores other actors here.
    if (level.initialState.actors.some((actor) => actor.id !== playerOf(level).id && actor.capabilities.canMove)) {
      assert.ok(solve(level, { othersAreWalls: false }).path.length > 0, `${name} has a path to its exit`);
      assert.match((await createPlaySession(level)).playerActorId, /delver/, `${name} plays the delver`);
      continue;
    }
    const { path } = solve(level);
    assert.ok(path.length > 0, `${name} has a path to its exit`);
    const session = await createPlaySession(level);
    await walk(session, path, (result, direction) => assert.equal(result.accepted.length, 1, `${name}: ${direction} ${JSON.stringify(result.rejected)} ${JSON.stringify(result.status)}`));
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
// The floor is for the characters that walk the level (delvers, wardens);
// traps and other fixed actors carry only the vitals their preset gives them.
test("every actor in a bundled or fixture level meets the actor viability floor", () => {
  const { ACTOR_VIABILITY_FLOOR } = require("../../packages/runtime/src/contracts/domain-constants.js");
  for (const { name, initialState } of [...loadBundledLevels(), ...fixtureLevels()]) {
    for (const actor of initialState.actors.filter((entry) => entry.capabilities.canMove)) {
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
  const game = await createGame({ levels: fixtureLevels(), fog: false });
  await game.handle(intentForKey("k"));
  assert.equal(game.state().turns, 1);
  assert.match(game.screen(), /A wall blocks the way\./);
  await runScripted(game, "dd");
  assert.equal(game.state().turns, 3);
  await game.handle({ type: INTENT.RESTART });
  assert.equal(game.state().turns, 0);
  assert.match(game.screen(), /S@\.\.#/);
});

test("each vital shows its regen after current/max, on the screen and the hud line", async () => {
  const { simConfig, initialState } = fixtureLevel("first-steps");
  const player = initialState.actors.find((actor) => actor.motivations?.includes("user_controlled")) ?? initialState.actors[0];
  player.vitals.health = { current: 7, max: 10, regen: 3 };
  const view = (await createPlaySession({ simConfig, initialState })).view();
  assert.match(renderScreen({ view, levelName: "first-steps" }), /HP █+░+ 7\/10 \(\+3\)/);
  assert.match(hudLine(view), /HP 7\/10 \(\+3\)/);
  for (const vital of view.player.vitals.filter((entry) => entry.max > 0)) {
    assert.match(hudLine(view), new RegExp(`${vital.label} ${vital.current}/${vital.max} \\(\\+${vital.regen}\\)`));
  }
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
  assert.deepEqual(parseArgs(["--level", "long-way-round", "--no-color"]), { color: false, fog: true, level: "long-way-round" });
  assert.deepEqual(parseArgs(["--", "--level", "warden-hall"]), { color: true, fog: true, level: "warden-hall" }, "pnpm's -- separator is ignored");
  assert.equal(parseArgs(["--no-fog"]).fog, false);
  assert.throws(() => parseArgs(["--level"]), /needs a value/);
  assert.throws(() => parseArgs(["--bogus"]), /Unknown option/);
  assert.equal(resolveLevels({ level: "long-way-round" }).startIndex, 1);
  assert.equal(resolveLevels({ level: "warden-hall" }).startIndex, 3);
  assert.equal(parseArgs(["--keys", "", "--json"]).json, true);
  assert.throws(() => resolveLevels({ simConfigPath: "x.json" }), /required together/);
});

// #204: `--record` saves a played game; `--replay` re-runs it and play continues from there.
test("the cli records a game into a directory that does not exist yet", () => {
  const files = [
    "--sim-config", join(FIXTURE_LEVELS_DIR, "first-steps.sim-config.json"),
    "--initial-state", join(FIXTURE_LEVELS_DIR, "first-steps.initial-state.json"),
  ];
  const dir = mkdtempSync(join(tmpdir(), "ak-maze-record-nested-"));
  try {
    const capturePath = join(dir, "games", "saves", "capture.json");
    const recorded = spawnSync(process.execPath, [CLI, ...files, "--json", "--keys", "d", "--record", capturePath], { encoding: "utf8" });
    assert.equal(recorded.status, 0, recorded.stderr);
    const capture = JSON.parse(require("node:fs").readFileSync(capturePath, "utf8"));
    assert.equal(capture.schema, "agent-kernel/CapturedInputArtifact");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the cli records a game and replays it to the same place", () => {
  const files = [
    "--sim-config", join(FIXTURE_LEVELS_DIR, "first-steps.sim-config.json"),
    "--initial-state", join(FIXTURE_LEVELS_DIR, "first-steps.initial-state.json"),
  ];
  const dir = mkdtempSync(join(tmpdir(), "ak-maze-record-"));
  try {
    const half = FIRST_STEPS_SOLUTION.slice(0, 6);
    const capturePath = join(dir, "capture.json");
    const recorded = spawnSync(process.execPath, [CLI, ...files, "--json", "--keys", half, "--record", capturePath], { encoding: "utf8" });
    assert.equal(recorded.status, 0, recorded.stderr);
    const capture = JSON.parse(require("node:fs").readFileSync(capturePath, "utf8"));
    assert.equal(capture.schema, "agent-kernel/CapturedInputArtifact");
    assert.equal(capture.source.adapter, "player");
    assert.equal(capture.payload.commands.length, half.length);

    const replayed = spawnSync(process.execPath, [CLI, ...files, "--json", "--replay", capturePath], { encoding: "utf8" });
    assert.equal(replayed.status, 0, replayed.stderr);
    assert.deepEqual(JSON.parse(replayed.stdout), JSON.parse(recorded.stdout), "the replay ends where the recording did");

    const finished = spawnSync(process.execPath, [CLI, ...files, "--json", "--replay", capturePath,
      "--keys", FIRST_STEPS_SOLUTION.slice(6)], { encoding: "utf8" });
    assert.equal(finished.status, 0, finished.stderr);
    const payload = JSON.parse(finished.stdout);
    assert.equal(payload.status.exited, true);
    assert.equal(payload.turns, FIRST_STEPS_SOLUTION.length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

test("the cli plays a level below the viability floor as written and warns about it", () => {
  const dir = mkdtempSync(join(tmpdir(), "ak-maze-floor-"));
  try {
    const vitals = viableVitals({ mana: 4 });
    const level = buildUnifiedLevel({ id: "weak_floor", tiles: ["#####", "#S.E#", "#####"],
      actors: [{ category: "delver", id: "delver_1", position: { x: 1, y: 1 }, motivations: ["user_controlled"], vitals }] });
    const { writeFileSync } = require("node:fs");
    writeFileSync(join(dir, "sim-config.json"), JSON.stringify(level.simConfig));
    writeFileSync(join(dir, "initial-state.json"), JSON.stringify(level.initialState));
    const files = ["--sim-config", join(dir, "sim-config.json"), "--initial-state", join(dir, "initial-state.json")];
    const json = spawnSync(process.execPath, [CLI, ...files, "--json", "--keys", ""], { encoding: "utf8" });
    assert.equal(json.status, 0, json.stderr);
    const message = "delver_1 mana max is 4, below the viability floor of 10.";
    // A hand-written level was never priced by the Allocator either, and says so (#279).
    const unpriced = "This level has no budget receipt, so it was not priced by the Allocator; build it with ak create to price it.";
    assert.deepEqual(JSON.parse(json.stdout).warnings, [unpriced, message]);
    assert.match(json.stderr, new RegExp(`warning: ${message.replace(/\./g, "\\.")}`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("other actors are drawn over the board rows with the snapshot's letters, never over the player", () => {
  const rows = ["#####", "#@..#", "#####"];
  const actors = [
    { id: "warden-1", role: "warden", position: { x: 3, y: 1 } },
    { id: "delver-2", role: "delver", position: { x: 2, y: 1 } },
    { id: "ghost", role: "warden", position: { x: 1, y: 1 } },
    { id: "lost", role: "warden", position: { x: 9, y: 9 } },
  ];
  assert.deepEqual(overlayActors(rows, actors, { x: 1, y: 1 }), ["#####", `#@${ASCII_ENTITY_GLYPHS.delver}${ASCII_ENTITY_GLYPHS.warden}#`, "#####"]);
  assert.equal(overlayActors(rows, undefined, null), rows, "no actors: the rows as-is");
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

test("colour depth (#286): 24-bit only when the terminal says so or the output is captured", () => {
  assert.equal(colorDepth({ isTTY: true, env: { COLORTERM: "truecolor" } }), "truecolor");
  assert.equal(colorDepth({ isTTY: true, env: { COLORTERM: "24bit" } }), "truecolor");
  // macOS Terminal sets no COLORTERM and misreads 24-bit codes.
  assert.equal(colorDepth({ isTTY: true, env: { TERM_PROGRAM: "Apple_Terminal" } }), "256");
  assert.equal(colorDepth({ isTTY: false, env: {} }), "truecolor");
  assert.equal(resolveColor({ color: true }, { isTTY: true, env: {} }), "256");
  assert.equal(resolveColor({ color: true }, { isTTY: true, env: { NO_COLOR: "1" } }), false);
  assert.equal(resolveColor({ color: "always" }, { isTTY: false, env: {} }), "truecolor");
});

test("xterm-256 picks the nearest cube colour or grey", () => {
  assert.equal(xterm256Index(0, 0, 0), 16);
  assert.equal(xterm256Index(255, 255, 255), 231);
  assert.equal(xterm256Index(255, 0, 0), 196);
  assert.equal(xterm256Index(128, 128, 128), 244);
  assert.equal(xterm256Index(0x3b, 0x32, 0x37), 237);
});

test("a 256-colour screen has the same text and no 24-bit codes", async () => {
  const session = await createPlaySession(fixtureLevel("first-steps"));
  const screen = renderScreen({ view: session.view(), levelName: "first-steps", color: "256" });
  assert.match(screen, /\u001b\[48;5;\d+m/);
  assert.doesNotMatch(screen, /\u001b\[[34]8;2;/);
  const plain = renderScreen({ view: session.view(), levelName: "first-steps" });
  assert.equal(screen.replace(/\u001b\[[0-9;]*m/g, ""), plain);
});

test("warden-hall's wardens wander once the play session runs their turns", async (context) => {
  const session = await createPlaySession(loadBundledLevel("warden-hall"));
  const start = session.view().actors;
  // Other actors only act (and are only reported) with the persona-routed play
  // session from the enemy-turns PR; until it lands this level is solo.
  if (!Array.isArray(start)) return context.skip();
  const startById = new Map(start.map((actor) => [actor.id, actor.position]));
  // A wandering warden can step back onto its start, so any turn off it counts.
  const moved = new Set();
  for (let turn = 0; turn < 6; turn += 1) {
    await session.act({ kind: "wait" });
    for (const actor of session.view().actors) {
      const from = startById.get(actor.id);
      if (from && (from.x !== actor.position.x || from.y !== actor.position.y)) moved.add(actor.id);
    }
  }
  assert.ok(moved.size > 0, "at least one warden left its starting cell");
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

test("trap-rooms draws each trap as H in its own affinity's fill, and a trap costs a vital", async () => {
  const { GAME_AFFINITY_COLOR_HEX } = require("../../packages/runtime/src/contracts/game-elements.js");
  const level = loadBundledLevel("trap-rooms");
  const session = await createPlaySession(level);
  const view = session.view();
  assert.ok(view.hazards.length > 0, "the level's hazards reach the view");
  const plain = renderScreen({ view, levelName: "trap-rooms" });
  const boardRows = plain.split("\n").slice(2, 2 + view.rows.length).map((row) => row.slice(2));
  for (const { position } of view.hazards) {
    assert.equal(boardRows[position.y][position.x], ASCII_ENTITY_GLYPHS.hazard, `trap at ${position.x},${position.y}`);
  }
  assert.match(plain, /Mind the traps \(H\)/);
  const colored = renderScreen({ view, levelName: "trap-rooms", color: true });
  // The traps are of different kinds on purpose: no one affinity is the trap affinity.
  const kinds = new Set(view.hazards.map((hazard) => hazard.affinities[0].kind));
  assert.ok(kinds.size > 1, "the bundled traps are not all one kind");
  for (const kind of kinds) {
    assert.ok(colored.includes(`${ansi(GAME_AFFINITY_COLOR_HEX[kind], 48)}`), `a ${kind} trap takes the ${kind} fill`);
  }
  assert.equal(colored.replace(/\u001b\[[0-9;]*m/g, ""), plain);

  // Walk onto the first trap along a breadth-first path and let core apply it.
  const trap = view.hazards[0].position;
  const { path } = solve(level, { target: trap });
  // #353: a trap hits its own kind's vital first and spills into health, so watch every vital.
  const vitals = () => Object.fromEntries(session.view().player.vitals.map((vital) => [vital.key, vital.current]));
  const before = vitals();
  // Track the lowest of each vital on the way: regen heals between traps, and opposed
  // traps side by side cancel on each other's tiles, so the end tile alone can read full.
  const lowest = { ...before };
  await walk(session, path, () => { for (const [key, current] of Object.entries(vitals())) lowest[key] = Math.min(lowest[key], current); });
  assert.deepEqual(session.view().player.position, trap);
  assert.ok(Object.keys(before).some((key) => lowest[key] < before[key]), "the trap hurt");
});

test("the game plays under fog of war by default; --no-fog shows the whole map", async () => {
  const { PLAY_SIGHT } = require("../../packages/runtime/src/runner/play-session.js");
  const fogged = await createGame({ levels: [loadBundledLevel("trap-rooms")] });
  const screen = fogged.screen();
  const board = screen.split("\n").filter((line) => /^ {2}[#?.@SEH]/.test(line));
  assert.ok(board.some((line) => line.includes("?")), "unseen cells are ?");
  assert.ok(board.every((line) => !line.includes("H")), "traps out of sight are hidden");
  assert.ok(board.some((line) => line.includes("@")));

  const clear = await createGame({ levels: [loadBundledLevel("trap-rooms")], fog: false });
  assert.doesNotMatch(clear.screen(), /\?{3}/);
  assert.match(clear.screen(), /H/);

  const seen = [];
  await createGame({
    levels: [fixtureLevel("first-steps")],
    createSession: async (args) => { seen.push(args.fog); return createPlaySession(args); },
  });
  assert.deepEqual(seen, [true], "the controller asks the play session for fog");
  assert.ok(Object.values(PLAY_SIGHT).includes("r"));
});

test("in colour, remembered cells are dimmed and unseen cells take the fog fill", async () => {
  const { asciiRememberedCellStyle, buildAsciiCellStyles } = require("../../packages/runtime/src/render/ascii-cell-style.js");
  const game = await createGame({ levels: [fixtureLevel("first-steps")] });
  await runScripted(game, "dd");
  const screen = game.screen({ color: true });
  const styles = buildAsciiCellStyles({ floor: ".", fog: "?" });
  const dim = asciiRememberedCellStyle(styles["."]);
  assert.ok(screen.includes(`${ansi(dim.bg, 48)}${ansi(dim.fg, 38)}`), "a remembered floor cell is dimmed");
  assert.ok(screen.includes(`${ansi(GAME_COLOR_PALETTE.tiles.fog, 48)}`), "unseen cells sit on the fog fill");
  const plain = game.screen();
  // Without colour there is no dimming, so remembered floor is drawn blank instead (#284).
  const stripped = screen.replace(/\u001b\[[0-9;]*m/g, "");
  assert.equal(stripped.length, plain.length, "colour adds escapes, and the plain screen keeps every cell");
  assert.ok([...plain].every((char, i) => char === stripped[i] || (char === " " && stripped[i] === ".")),
    "the only plain-text difference is remembered floor drawn blank");
  assert.ok([...plain].some((char, i) => char !== stripped[i]), "some remembered floor is blank without colour");
  assert.equal(paintBoardRow("..", styles, null, "rv"), `${ansi(dim.bg, 48)}${ansi(dim.fg, 38)}.\u001b[0m${ansi(styles["."].bg, 48)}${ansi(styles["."].fg, 38)}.\u001b[0m`);
});

// #202: affinities from the keyboard. `i` lists them, a digit equips, `f` aims and casts, `g` takes.
function duelLevels({ wardenAt = { x: 2, y: 1 }, pushKind = "water" } = {}) {
  const level = buildUnifiedLevel({
    id: "duel",
    tiles: ["######", "#....#", "#....E", "######"],
    actors: [
      { category: "delver", id: "delver_1", position: { x: 1, y: 1 }, motivations: ["user_controlled"],
        vitals: viableVitals({ mana: 40 }), affinities: [
          { kind: pushKind, expression: "push", stacks: 3, intensity: 2 }, { kind: "light", expression: "emit", stacks: 1 }] },
      ...(wardenAt ? [{ category: "warden", id: "warden_1", position: wardenAt, motivations: ["stationary"],
        vitals: viableVitals(), affinities: [{ kind: "fire", expression: "push", stacks: 1 }] }] : []),
    ],
  });
  return [{ name: "duel", ...level }];
}
const press = async (game, keys) => { for (const key of splitKeys(keys)) await game.handle(intentForKey(key)); };

test("affinity keys map to intents: i, f, g, Tab and the digits", () => {
  assert.deepEqual(intentForKey("i"), { type: INTENT.AFFINITIES });
  assert.deepEqual(intentForKey("f"), { type: INTENT.CAST });
  assert.deepEqual(intentForKey("g"), { type: INTENT.TAKE });
  assert.deepEqual(intentForKey("\t"), { type: INTENT.NEXT_TARGET });
  assert.deepEqual(intentForKey("1"), { type: INTENT.SELECT, index: 0 });
  assert.deepEqual(intentForKey("9"), { type: INTENT.SELECT, index: 8 });
});

test("i lists the known affinities for free; a digit equips one and costs the turn", async () => {
  const game = await createGame({ levels: duelLevels(), fog: false });
  await press(game, "i");
  assert.equal(game.state().turns, 0);
  assert.match(game.screen(), /1\) water push ×3/);
  assert.match(game.screen(), /2\) light emit ×1/);
  await press(game, "1");
  assert.equal(game.state().turns, 1);
  assert.doesNotMatch(game.screen(), /1\) water push/, "the panel closes after a choice");
  assert.match(game.screen(), /Slot 1: water push ×3/);
  assert.match(game.screen(), /Slot 2: empty/);
});

test("the HUD shows a row per slot; in the panel a digit equips into a free slot or unequips", async () => {
  const game = await createGame({ levels: duelLevels(), fog: false });
  assert.match(game.screen(), /Slots: all 3 empty \(press i to equip\)/);
  await press(game, "i1i2");
  assert.match(game.screen(), /Slot 1: water push ×3\n.*Slot 2: light emit ×1\n.*Slot 3: empty/);
  await press(game, "i");
  assert.match(game.screen(), /1\) water push ×3  \[slot 1\]/);
  await press(game, "1");
  assert.equal(game.state().turns, 3);
  assert.match(game.screen(), /Unequipped water push\./);
  assert.match(game.screen(), /Slot 1: light emit ×1/);
});

test("outside a panel, a slot's digit aims that slot; Enter casts it", async () => {
  const game = await createGame({ levels: duelLevels(), fog: false });
  await press(game, "i2i1");
  await press(game, "1");
  assert.match(game.screen(), /light emit works on its own while equipped\./);
  assert.equal(game.state().turns, 2);
  await press(game, "3");
  assert.match(game.screen(), /Slot 3 is empty\./);
  await press(game, "2");
  assert.match(game.screen(), /Target: warden_1/);
  await press(game, "\r");
  assert.equal(game.state().turns, 3);
  assert.match(game.screen(), /You cast water push at warden_1\./);
});

test("Esc closes a panel instead of quitting", async () => {
  const game = await createGame({ levels: duelLevels(), fog: false });
  await press(game, "i");
  assert.deepEqual(await game.handle(intentForKey("\u001b")), { quit: false });
  assert.doesNotMatch(game.screen(), /1\) water push/);
  assert.equal(game.state().turns, 0);
});

test("f aims at the nearest actor in sight and Enter casts at it", async () => {
  const game = await createGame({ levels: duelLevels(), fog: false });
  await press(game, "i1f");
  assert.match(game.screen(), /Target: warden_1/);
  assert.equal(game.state().turns, 1, "aiming is free");
  await press(game, "\r");
  assert.equal(game.state().turns, 2);
  assert.match(game.screen(), /You cast water push at warden_1\./);
});

test("a cast core refuses says why and costs the turn", async () => {
  const game = await createGame({ levels: duelLevels(), fog: false });
  await press(game, "f\r");
  assert.equal(game.state().turns, 1);
  assert.match(game.screen(), /Nothing is equipped\. Press i to equip an affinity\./);
});

test("f with nobody in sight, and g with nothing to take, say so without spending a turn", async () => {
  const game = await createGame({ levels: duelLevels({ wardenAt: null }), fog: false });
  await press(game, "f");
  assert.match(game.screen(), /Nothing in sight to cast at\./);
  await press(game, "g");
  assert.match(game.screen(), /Nothing here to take\./);
  assert.equal(game.state().turns, 0);
});

test("g takes the loot of a defeated neighbour", async () => {
  // #353: decay hits the defeat vital (health) directly; water would empty stamina first.
  const game = await createGame({ levels: duelLevels({ pushKind: "decay" }), fog: false });
  await press(game, "i1");
  for (let i = 0; i < 6 && /Target: warden_1/.test((await press(game, "f"), game.screen())); i += 1) await press(game, "\r");
  await press(game, "\u001b");
  await press(game, "g");
  assert.match(game.screen(), /You take fire push from warden_1\./);
  await press(game, "i");
  assert.match(game.screen(), /fire push ×1/);
});

// #230: in the affinity list, Tab picks a row and + / - run it at fewer or more stacks.
test("+ and - re-level the highlighted equipped affinity, a turn each; the HUD shows running/held", async () => {
  const game = await createGame({ levels: duelLevels(), fog: false });
  assert.deepEqual(intentForKey("-"), { type: INTENT.LEVEL_DOWN });
  assert.deepEqual(intentForKey("+"), { type: INTENT.LEVEL_UP });
  await press(game, "i1i");
  assert.match(game.screen(), /> 1\) water push ×3  \[slot 1\]/);
  await press(game, "--");
  assert.equal(game.state().turns, 3);
  assert.match(game.screen(), /water push now runs at 1 of 3 stacks\./);
  assert.match(game.screen(), /> 1\) water push ×3  \[slot 1, running 1\]/, "the panel stays open");
  await press(game, "-");
  assert.match(game.screen(), /already runs at its lowest, 1 stack\./);
  assert.equal(game.state().turns, 3, "a refused step is free");
  await press(game, "\u001b");
  assert.match(game.screen(), /Slot 1: water push ×1\/3/);
  await press(game, "i+");
  assert.match(game.screen(), /Slot 1: water push ×2\/3/);
  await press(game, "\t+");
  assert.match(game.screen(), /> 2\) light emit ×1/);
  assert.match(game.screen(), /Equip it first \(press its number\)\./);
});

test("a cast at a lowered level reaches only that far", async () => {
  const game = await createGame({ levels: duelLevels({ wardenAt: { x: 3, y: 1 } }), fog: false });
  await press(game, "i1i--\u001b");
  await press(game, "f\r");
  assert.match(game.screen(), /Out of range\./);
});

// #201: the game can be lost; the defeat screen says how to try again, and r restarts.
test("a defeated player sees the defeat line; moves do nothing and r restarts the level", async () => {
  const level = buildUnifiedLevel({
    id: "ambush",
    tiles: ["######", "#....#", "#....E", "######"],
    actors: [
      { category: "delver", id: "delver_1", position: { x: 1, y: 1 }, motivations: ["user_controlled"],
        vitals: viableVitals(), affinities: [] },
      { category: "warden", id: "warden_1", position: { x: 2, y: 1 }, motivations: ["attacking"],
        vitals: viableVitals({ mana: 200 }), affinities: [{ kind: "fire", expression: "push", stacks: 3, intensity: 2 }],
        activeAffinityKey: "fire:push" },
    ],
  });
  const game = await createGame({ levels: [{ name: "ambush", ...level }], fog: false });
  for (let i = 0; i < 30 && !/defeated/.test(game.screen()); i += 1) await press(game, ".");
  assert.match(game.screen(), /You were defeated\. Press r to try the level again, q to quit\./);
  const turns = game.state().turns;
  await press(game, "d");
  assert.equal(game.state().turns, turns, "a move after defeat is ignored");
  await press(game, "r");
  assert.doesNotMatch(game.screen(), /You were defeated/);
});

// ## TODO: Test Permutations
// - every key in the keymap, upper and lower case
// - --run with each of the build/create/configurator subdirectories
// - --sim-config/--initial-state with one path missing
// - NEXT_LEVEL from each bundled level in turn
// - help toggle hides and restores the help lines
// - Tab cycles through every actor in sight, nearest first, and wraps
// - with two loot items g opens a numbered list
// - casting an emit says it works while equipped
// - equipping into full slots names the affinity it replaced
// - an exhausted slot's HUD row says it is off until mana is full
// - Tab in the affinity list wraps from the last row to the first
// - + at full stacks says it already runs at all held stacks

// #291: turn-based by default; real time is an opt-in wait turn on a timer.
const { DEFAULT_REALTIME_MS, REALTIME_TOGGLE_KEY, parseRealtimeMs, realtimeBeat, realtimeLine } = require("../../packages/ui-ascii/src/realtime.js");

test("--realtime takes whole milliseconds of at least 50; play is turn-based without it", () => {
  assert.equal(parseArgs([]).realtimeMs, undefined);
  assert.equal(parseArgs(["--realtime", "250"]).realtimeMs, 250);
  assert.throws(() => parseArgs(["--realtime", "10"]), /at least 50/);
  assert.throws(() => parseArgs(["--realtime", "fast"]), /whole milliseconds/);
  assert.equal(parseRealtimeMs("50"), 50);
  assert.equal(DEFAULT_REALTIME_MS, 500);
  assert.equal(REALTIME_TOGGLE_KEY, "t");
  assert.equal(intentForKey("t"), null, "t is free for the toggle");
});

test("a real-time beat is a wait turn, and pauses while a panel is open or the level is over", async () => {
  const game = await createGame({ levels: duelLevels(), fog: false });
  assert.equal(await realtimeBeat(game), true);
  assert.equal(game.state().turns, 1, "a beat costs one turn, exactly like pressing .");
  await press(game, "i");
  assert.equal(await realtimeBeat(game), false);
  assert.equal(game.state().turns, 1, "no beat while the affinity list is open");

  const finished = await createGame({ levels: fixtureLevels() });
  await runScripted(finished, FIRST_STEPS_SOLUTION);
  const turns = finished.state().turns;
  assert.equal(await realtimeBeat(finished), false);
  assert.equal(finished.state().turns, turns, "no beat after the exit");
});

test("the real-time line names the mode and the toggle key", () => {
  assert.match(realtimeLine({ on: true, intervalMs: 250 }), /every 250 ms.*t pauses/);
  assert.match(realtimeLine({ on: false, intervalMs: 500 }), /Turn-based.*t for real time/);
});
