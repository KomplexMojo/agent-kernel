/**
 * `ak play-session` (Phase 2): a game that lasts across calls, kept in
 * artifacts/play-sessions/<name>.json (here a temp dir, through AK_PLAY_SESSIONS_DIR), for a caller that is not at a terminal.
 * start / act / view / switch / end, with the party of user_controlled actors
 * an `ak create` level authors.
 */
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { existsSync, mkdtempSync, readFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const os = require("node:os");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const SESSIONS = mkdtempSync(join(os.tmpdir(), "ak-play-sessions-"));
const FLOOR = "vitals=health:10:1,mana:10:1,stamina:10:1,durability:10:1";

function ak(args) {
  const result = spawnSync(process.execPath, [CLI, ...args],
    { cwd: ROOT, encoding: "utf8", env: { ...process.env, AK_PLAY_SESSIONS_DIR: SESSIONS } });
  const line = result.stdout.trim().split("\n").filter(Boolean).at(-1);
  return { status: result.status, stderr: result.stderr, json: line ? JSON.parse(line) : null };
}

function partyRun() {
  const outDir = mkdtempSync(join(os.tmpdir(), "ak-play-session-"));
  const made = ak(["create", "--room", "size=medium;count=2",
    "--delver", `count=2;id=hero;affinity=wind;motivation=user_controlled+exploring;${FLOOR}`,
    "--delver", `count=1;id=pal;affinity=earth;motivation=exploring;${FLOOR}`,
    "--warden", "count=1;affinity=fire;motivation=stationary",
    "--budget-tokens", "6000", "--created-at", "2026-10-14T00:00:00.000Z", "--out-dir", outDir]);
  assert.equal(made.status, 0, made.stderr);
  return outDir;
}

const name = (suffix) => `test-${suffix}`;

test("start, act, switch, view and end one game", () => {
  const dir = partyRun();
  const session = name("growth");
  const started = ak(["play-session", "start", "--session", session, "--dir", dir, "--keys", "."]);
  assert.equal(started.json.ok, true, started.stderr);
  assert.equal(started.json.turns, 1);
  assert.equal(started.json.active, "hero-1");
  assert.deepEqual(started.json.party.map((member) => [member.id, member.label]), [["hero-1", "D1"], ["hero-2", "D2"]]);
  assert.ok(existsSync(join(SESSIONS, `${session}.json`)), "the game is saved");
  assert.match(readFileSync(join(SESSIONS, "hud.txt"), "utf8"), /^D1 hero-1 · /);

  const switched = ak(["play-session", "switch", "--session", session, "--actor", "D2"]);
  assert.equal(switched.json.active, "hero-2");
  assert.equal(switched.json.turns, 1, "a switch is free");

  const companion = ak(["play-session", "switch", "--session", session, "--actor", "D3"]);
  assert.equal(companion.json.results[0].reason, "not_playable", "a companion is not playable");
  assert.equal(companion.json.active, "hero-2");

  const acted = ak(["play-session", "act", "--session", session,
    "--commands", JSON.stringify([{ kind: "wait" }, { kind: "wait", actorId: "D1" }])]);
  assert.equal(acted.json.turns, 3);
  assert.deepEqual(acted.json.results.map((result) => result.accepted[0]?.actorId), ["hero-2", "hero-1"]);

  const viewed = ak(["play-session", "view", "--session", session]);
  assert.equal(viewed.json.turns, 3);
  assert.equal(viewed.json.active, "hero-2");

  const keep = join(SESSIONS, "kept", "game.json");
  const ended = ak(["play-session", "end", "--session", session, "--save", keep]);
  assert.equal(ended.json.ended, true);
  assert.equal(ended.json.turns, 3);
  assert.equal(ended.json.saved, keep);
  assert.equal(existsSync(join(SESSIONS, `${session}.json`)), false, "end removes the live game");

  const loaded = ak(["play-session", "start", "--session", name("loaded"), "--load", keep]);
  assert.equal(loaded.json.ok, true, loaded.stderr);
  assert.equal(loaded.json.turns, 3, "a saved game reopens where it was left");
  assert.equal(loaded.json.active, "hero-2");
  ak(["play-session", "end", "--session", name("loaded")]);
});

test("each action says what it needs", () => {
  const dir = partyRun();
  const session = name("rules");
  assert.match(ak(["play-session", "act", "--session", session]).json.error, /No play-session/);
  assert.match(ak(["play-session"]).json.error, /needs an action/);
  assert.match(ak(["play-session", "start", "--session", "../x", "--dir", dir]).json.error, /plain name/);
  ak(["play-session", "start", "--session", session, "--dir", dir]);
  assert.match(ak(["play-session", "start", "--session", session, "--dir", dir]).json.error, /already running/);
  assert.match(ak(["play-session", "act", "--session", session, "--dir", dir]).json.error, /level options go with start/);
  assert.match(ak(["play-session", "view", "--session", session, "--keys", "."]).json.error, /plays nothing/);
  assert.match(ak(["play-session", "switch", "--session", session]).json.error, /needs --actor/);
  assert.match(ak(["play-session", "act", "--session", session, "--load", "x.json"]).json.error, /--load goes with start/);
  ak(["play-session", "end", "--session", session]);
});

test("order gives a companion a strategy for one turn, and advance lets it play out", () => {
  const dir = partyRun();
  const session = name("orders");
  ak(["play-session", "start", "--session", session, "--dir", dir]);
  const ordered = ak(["play-session", "order", "--session", session, "--actor", "D3", "--strategy", "follow:D1"]);
  assert.equal(ordered.json.ok, true, ordered.stderr);
  assert.equal(ordered.json.turns, 1, "an order is a turn");
  assert.equal(ordered.json.results[0].actorId, "pal-1");
  assert.deepEqual(ordered.json.orders.map((entry) => [entry.label, entry.doing]),
    [["D3", { kind: "follow", target: "hero-1", distance: 1 }]]);

  const advanced = ak(["play-session", "advance", "--session", session, "--ticks", "3"]);
  assert.equal(advanced.json.turns, 4);
  assert.equal(advanced.json.results[0].ticks, 3);

  assert.match(ak(["play-session", "order", "--session", session, "--actor", "D3"]).json.error, /needs --actor .* and --strategy/);
  assert.match(ak(["play-session", "act", "--session", session, "--ticks", "2"]).json.error, /go with advance/);
  ak(["play-session", "end", "--session", session]);
});

// ## TODO: Test Permutations
// - start --from-run <id> plays the level under artifacts/runs/<id>.
// - act with keys and commands applies commands first, then keys.
// - a save written before party control (no activeActorId) reopens on the first player.
// - end on a defeated or escaped game still returns its final board.
// - order with a JSON strategy and with a .json file; an order to a warden answers not_yours.
// - advance --until orders_done stops before --ticks once every order is done or stalled.
