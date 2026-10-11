/**
 * The ASCII board's colours are visual semantics, so they come from runtime
 * render and every value is an entry of the approved palette. A terminal UI
 * only converts them to escape codes.
 */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const {
  ASCII_REMEMBERED_FADE,
  asciiActorCellStyle,
  asciiRememberedCellStyle,
  buildAsciiCellStyles,
} = require("../../packages/runtime/src/render/ascii-cell-style.js");
const { GAME_AFFINITY_COLOR_HEX } = require("../../packages/runtime/src/contracts/game-elements.js");
const { normalizeEntitySpriteState, outlineForFill } = require("../../packages/runtime/src/render/entity-sprite-composer.js");
const { GAME_COLOR_PALETTE } = require("../../packages/runtime/src/contracts/game-elements.js");
const { ASCII_ENTITY_GLYPHS } = require("../../packages/runtime/src/render/visualization-snapshot.js");
const { createPlaySession } = require("../../packages/runtime/src/runner/play-session.js");

const FIXTURES = resolve(__dirname, "../fixtures/artifacts");
const readFixture = (name) => JSON.parse(readFileSync(resolve(FIXTURES, name), "utf8"));

async function coreLegend() {
  const session = await createPlaySession({
    simConfig: readFixture("sim-config-artifact-v1-mvp-grid.json"),
    initialState: readFixture("initial-state-artifact-v1-mvp-actor.json"),
  });
  return session.view().legend;
}

function paletteValues(node, out = new Set()) {
  if (typeof node === "string") out.add(node.toLowerCase());
  else if (node && typeof node === "object") Object.values(node).forEach((value) => paletteValues(value, out));
  return out;
}

test("every colour is a value of the approved palette", async () => {
  const approved = paletteValues(GAME_COLOR_PALETTE);
  const styles = buildAsciiCellStyles(await coreLegend());
  for (const [char, { fg, bg }] of Object.entries(styles)) {
    assert.ok(approved.has(fg.toLowerCase()), `${char} fg ${fg}`);
    assert.ok(approved.has(bg.toLowerCase()), `${char} bg ${bg}`);
  }
});

test("tiles are flat fills from palette.tiles, keyed by core's own legend", async () => {
  const legend = await coreLegend();
  const styles = buildAsciiCellStyles(legend);
  for (const kind of ["wall", "floor", "spawn", "exit"]) {
    assert.equal(styles[legend[kind]].bg, GAME_COLOR_PALETTE.tiles[kind], kind);
  }
  assert.equal(styles[legend.wall].fg, GAME_COLOR_PALETTE.tileBorders.wall);
});

test("the player is the user-controlled colour; other entities wear their role colour on floor", async () => {
  const legend = await coreLegend();
  const styles = buildAsciiCellStyles(legend);
  assert.equal(styles[legend.actor].fg, GAME_COLOR_PALETTE.motivations.user_controlled);
  assert.equal(styles[ASCII_ENTITY_GLYPHS.delver].fg, GAME_COLOR_PALETTE.actors.delver);
  assert.equal(styles[ASCII_ENTITY_GLYPHS.warden].fg, GAME_COLOR_PALETTE.actors.warden);
  assert.equal(styles[ASCII_ENTITY_GLYPHS.hazard].fg, GAME_COLOR_PALETTE.items.hazard);
  assert.equal(styles[ASCII_ENTITY_GLYPHS.resource].fg, GAME_COLOR_PALETTE.items.resource);
  assert.equal(styles[ASCII_ENTITY_GLYPHS.warden].bg, GAME_COLOR_PALETTE.tiles.floor);
});

test("characters follow the legend it is given, not a copy of core's", () => {
  const styles = buildAsciiCellStyles({ wall: "X", floor: "_", actor: "P" });
  assert.equal(styles.X.bg, GAME_COLOR_PALETTE.tiles.wall);
  assert.equal(styles._.bg, GAME_COLOR_PALETTE.tiles.floor);
  assert.equal(styles.P.fg, GAME_COLOR_PALETTE.motivations.user_controlled);
  assert.equal(styles["#"], undefined);
  assert.equal(buildAsciiCellStyles(undefined)["@"], undefined);
});

test("an actor's equipped affinity is its cell fill, with the sprite's outline as the letter colour", () => {
  for (const [kind, fill] of Object.entries(GAME_AFFINITY_COLOR_HEX)) {
    const style = asciiActorCellStyle({ affinities: [{ kind, expression: "push", stacks: 1 }] });
    assert.deepEqual(style, { bg: fill, fg: outlineForFill(fill), affinity: kind }, kind);
  }
});

test("affinity is read the way the board sprite reads it, in every live shape", () => {
  const shapes = [
    { affinity: "water" },
    { affinity: { kind: "water" } },
    { equippedAffinity: { kind: "water" } },
    { affinities: [{ kind: "water" }] },
    { affinityStacks: [{ kind: "water" }] },
    { traits: { affinities: { "water:push": 1 } } },
  ];
  for (const entity of shapes) {
    assert.equal(asciiActorCellStyle(entity).affinity, "water", JSON.stringify(entity));
    assert.equal(normalizeEntitySpriteState(entity).affinity, "water", "sprite agrees");
  }
});

test("an actor with no affinity gets no affinity style (the sprite's default fill does not leak in)", () => {
  assert.equal(asciiActorCellStyle({ role: "warden" }), null);
  assert.equal(asciiActorCellStyle({ affinities: [] }), null);
  assert.equal(asciiActorCellStyle({ affinity: "not-an-affinity" }), null);
});

test("fog of war: unseen cells take the fog fill; remembered cells fade toward it", async () => {
  const legend = await coreLegend();
  assert.equal(legend.fog, "?", "the play session names the fog glyph");
  const styles = buildAsciiCellStyles(legend);
  assert.equal(styles["?"].bg, GAME_COLOR_PALETTE.tiles.fog);
  assert.equal(styles["?"].fg, GAME_COLOR_PALETTE.types.untyped);

  const floor = styles[legend.floor];
  const remembered = asciiRememberedCellStyle(floor);
  const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const fog = channels(GAME_COLOR_PALETTE.tiles.fog);
  for (const layer of ["fg", "bg"]) {
    const from = channels(floor[layer]);
    const to = channels(remembered[layer]);
    to.forEach((channel, i) => {
      assert.ok(Math.abs(channel - (from[i] + (fog[i] - from[i]) * ASCII_REMEMBERED_FADE)) <= 0.5, `${layer} channel ${i}`);
    });
  }
  assert.notDeepEqual(remembered, floor);
  assert.equal(asciiRememberedCellStyle(null), null);
});

// ## TODO: Test Permutations
// - a legend with barrier: B takes tiles.barrier
// - a remembered style with a malformed hex keeps that colour unchanged
// - legend characters that collide with entity glyphs (entity colour wins)
