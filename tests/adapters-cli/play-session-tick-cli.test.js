// #680: `ak play-session tick --actor-commands` runs one tick for several ai_controlled actors,
// from a saved session file, and refuses the player's party without stopping the rest.
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const os = require("node:os");
const { buildUnifiedLevel, viableVitals } = require("../fixtures/ui-ascii/unified-level.mjs");

const ROOT = resolve(__dirname, "../..");
const AK = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const SESSIONS = mkdtempSync(join(os.tmpdir(), "tick-cli-sessions-"));
const actor = (category, id, position, motivations) => ({ category, id, position, vitals: viableVitals(), motivations });

function writeLevel() {
  const built = buildUnifiedLevel({ id: "tick_cli", tiles: ["###########", "S.........#", "#.........#", "#.........E", "###########"], actors: [
    actor("delver", "hero", { x: 1, y: 1 }, ["user_controlled"]),
    actor("warden", "guard", { x: 8, y: 1 }, ["ai_controlled"]),
    actor("warden", "sentry", { x: 8, y: 3 }, ["ai_controlled"]),
  ] });
  const dir = mkdtempSync(join(os.tmpdir(), "tick-cli-level-"));
  writeFileSync(join(dir, "sim-config.json"), JSON.stringify(built.simConfig));
  writeFileSync(join(dir, "initial-state.json"), JSON.stringify(built.initialState));
  return dir;
}

const ak = (...args) => spawnSync(process.execPath, [AK, "play-session", ...args], {
  cwd: ROOT, encoding: "utf8", env: { ...process.env, AK_PLAY_SESSIONS_DIR: SESSIONS },
});

test("tick commands two ai_controlled actors in one tick and names the refused one", () => {
  const dir = writeLevel();
  const started = ak("start", "--session", "t", "--dir", dir);
  assert.equal(started.status, 0, started.stderr);
  const tick0 = JSON.parse(started.stdout).status.tick;
  const run = ak("tick", "--session", "t", "--actor-commands", JSON.stringify({
    guard: { kind: "move", params: { direction: "west" } },
    sentry: { kind: "move", params: { direction: "west" } },
    hero: { kind: "wait" },
  }));
  assert.equal(run.status, 0, run.stderr);
  const out = JSON.parse(run.stdout);
  assert.equal(out.action, "tick");
  assert.equal(out.status.tick, tick0 + 1);
  const result = out.results[0];
  assert.deepEqual(result.accepted.map((entry) => entry.actorId).sort(), ["guard", "sentry"]);
  assert.deepEqual(result.rejected.map((entry) => [entry.actorId, entry.reason]), [["hero", "not_playable"]]);
  // The log replays: a following view re-runs the game and lands on the same tick.
  const view = JSON.parse(ak("view", "--session", "t").stdout);
  assert.equal(view.status.tick, tick0 + 1);
  ak("end", "--session", "t");
});

test("tick needs --actor-commands and refuses the other play flags", () => {
  const dir = writeLevel();
  assert.equal(ak("start", "--session", "t2", "--dir", dir).status, 0);
  assert.match(ak("tick", "--session", "t2").stderr, /needs --actor-commands/);
  assert.match(ak("tick", "--session", "t2", "--actor-commands", "[1]").stderr, /JSON object/);
  assert.match(ak("tick", "--session", "t2", "--actor-commands", "{}").stderr, /at least one entry/);
  assert.match(ak("act", "--session", "t2", "--actor-commands", "{}").stderr, /goes with tick/);
  ak("end", "--session", "t2");
});

// ## TODO: Test Permutations
// - ak_play_tick over the MCP server
// - --save with tick
