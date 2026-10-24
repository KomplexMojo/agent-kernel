import { normalizeVitals } from "../contracts/domain-constants.js";

// M9: declared in contracts/artifacts.ts, re-exported here under the name importers use.
import { VISUALIZATION_SNAPSHOT_SCHEMA } from "../contracts/artifacts.ts";

export { VISUALIZATION_SNAPSHOT_SCHEMA };
export const VISUALIZATION_SNAPSHOT_VERSION = 1;

/**
 * The ASCII glyph vocabulary for board entities. Exported so every ASCII
 * surface (this snapshot, `packages/ui-ascii`) draws the same letter for the
 * same thing instead of each restating it.
 */
export const ASCII_ENTITY_GLYPHS = Object.freeze({
  delver: "D",
  warden: "W",
  hazard: "H",
  resource: "R",
});

/**
 * The ASCII glyph for each terrain kind of a unified layout (`layout.data.terrain`).
 * A level's own `layout.data.render` legend, when present, uses the same keys.
 * Destructible barriers are actors, drawn with the `barrier` glyph.
 */
export const ASCII_TERRAIN_GLYPHS = Object.freeze({
  wall: "#",
  floor: ".",
  spawn: "S",
  exit: "E",
  barrier: "B",
});

/** The glyph for a cell the viewer has not seen (fog of war); `resource-bundle.js` maps it to the `fog` tile. */
export const ASCII_FOG_GLYPH = "?";
/** The tile a cast is being aimed at (#413), drawn over the board while aiming. */
export const ASCII_AIM_GLYPH = "+";

/**
 * The arrow a floor cell on a cast's path shows for the turn of the cast (#463), by the
 * direction it points: away from the caster for a push, back toward it for a pull, so what
 * a pull extracts is seen coming home. Diagonals read as `/` and `\` either way.
 */
export const ASCII_CAST_PATH_GLYPHS = Object.freeze({
  east: ">", west: "<", north: "^", south: "v",
  northeast: "/", southwest: "/", northwest: "\\", southeast: "\\",
});

/** The arrow for one step of a cast's path, `from` the previous cell `to` this one. */
export function asciiCastPathGlyph(from, to, expression) {
  const sign = expression === "pull" || expression === "draw" ? -1 : 1;
  const dx = sign * Math.sign(to.x - from.x);
  const dy = sign * Math.sign(to.y - from.y);
  const vertical = dy < 0 ? "north" : dy > 0 ? "south" : "";
  const horizontal = dx > 0 ? "east" : dx < 0 ? "west" : "";
  return ASCII_CAST_PATH_GLYPHS[`${vertical}${horizontal}`] ?? null;
}

/**
 * An actor's glyph, read the way this snapshot reads it (`inferKind`): a role
 * naming a hazard or resource takes that glyph; a role, kind or id naming a
 * warden makes a warden; anything else is a delver. Generated levels leave
 * `role` null and say it in the id (`card_warden_1-1`).
 */
export function asciiGlyphForActor(actor) {
  const role = String(actor?.role || "").toLowerCase();
  if (role === "hazard" || role === "resource") return ASCII_ENTITY_GLYPHS[role];
  if (role === "barrier") return ASCII_TERRAIN_GLYPHS.barrier;
  return inferKind(actor || {}) === "warden" ? ASCII_ENTITY_GLYPHS.warden : ASCII_ENTITY_GLYPHS.delver;
}

function buildBlankGrid(width, height) {
  return Array.from({ length: height }, () => " ".repeat(width));
}

function addCoordinateLegend(rows) {
  if (!rows || rows.length === 0) return "";
  const height = rows.length;
  const width = rows[0].length;
  const colLabelLen = `x=${width - 1}`.length;
  const rowPrefixLen = `y=${height - 1}: `.length;
  const cellWidth = colLabelLen + 1;
  const header = " ".repeat(rowPrefixLen) +
    Array.from({ length: width }, (_, x) => `x=${x}`.padEnd(cellWidth)).join("").trimEnd();
  const dataRows = rows.map((row, y) => {
    const prefix = `y=${y}: `.padEnd(rowPrefixLen);
    const cells = row.split("").map((ch, x) => (x < width - 1 ? ch.padEnd(cellWidth) : ch)).join("");
    return prefix + cells;
  });
  return [header, ...dataRows].join("\n");
}

function markPosition(rows, x, y, char) {
  if (y < 0 || y >= rows.length) return;
  const row = rows[y];
  if (x < 0 || x >= row.length) return;
  rows[y] = row.slice(0, x) + char + row.slice(x + 1);
}

// #147 — this used to take a single `tickFrame` and overlay only that one frame's
// `acceptedActions`. The frame callers had on hand (readTickFrame's "last phase-frame for this
// tick", i.e. `summarize`) always carries `acceptedActions: []` by construction — the actual moves
// land on that tick's earlier `apply` phase-frame — so the overlay never applied and every actor
// rendered frozen at its initial-state.json spawn position for the whole run. Fixed by replaying
// every accepted move from every frame up to and including the requested tick, cumulatively — the
// same approach adapters-cli's own resolveActorPositionsAtTick() (tick-session.mjs) already used
// correctly; this was the one caller of this data that didn't.
function computeActorPositions(initialState, frames, tick) {
  const positions = new Map();
  for (const actor of initialState.actors) {
    positions.set(actor.id, { x: actor.position.x, y: actor.position.y });
  }
  if (!Array.isArray(frames)) return positions;
  const limit = Number.isFinite(tick) ? tick : Infinity;
  for (const frame of frames) {
    if (Number.isFinite(frame?.tick) && frame.tick > limit) break;
    for (const action of frame?.acceptedActions || []) {
      if (action?.kind !== "move") continue;
      const to = action.params?.target;
      if (!Number.isFinite(to?.x) || !Number.isFinite(to?.y)) continue;
      positions.set(action.actorId, { x: to.x, y: to.y });
    }
  }
  return positions;
}

function inferKind(actor, presentation) {
  const category = presentation?.[actor.id]?.category;
  if (category) return category;
  const raw = `${actor.role || ""} ${actor.kind || ""} ${actor.id || ""}`.toLowerCase();
  return raw.includes("warden") ? "warden" : "delver";
}

function collectAffinities(actor) {
  const entries = [];
  if (Array.isArray(actor.affinities)) {
    for (const a of actor.affinities) {
      const name = (a.name || a.kind || "").trim().toLowerCase();
      if (name) entries.push({ name, stacks: Number(a.stacks) || 1, expression: a.expression || "" });
    }
  }
  const traitAff = actor.traits?.affinities;
  if (traitAff && typeof traitAff === "object" && !Array.isArray(traitAff)) {
    for (const [raw, rawStacks] of Object.entries(traitAff)) {
      const [kindPart, exprPart] = raw.split(":");
      const name = kindPart.trim().toLowerCase();
      if (name) entries.push({ name, stacks: Number(rawStacks) || 1, expression: (exprPart || "").trim() });
    }
  }
  if (entries.length === 0 && typeof actor.affinity === "string" && actor.affinity.trim()) {
    entries.push({ name: actor.affinity.trim().toLowerCase(), stacks: 1, expression: actor.expression || "" });
  }
  return entries;
}

function buildActorDetails(initialState, actorPositions) {
  const presentation = initialState.presentation || {};
  return initialState.actors.map((actor) => {
    const pos = actorPositions.get(actor.id) || actor.position;
    const motivations = Array.isArray(actor.motivations) ? actor.motivations : [];
    return {
      id: actor.id,
      kind: inferKind(actor, presentation),
      position: { x: pos.x, y: pos.y },
      affinities: collectAffinities(actor),
      vitals: normalizeVitals(actor.vitals),
      motivation: motivations[0] || actor.motivation || actor.traits?.motivation || "unknown",
    };
  });
}

function layoutRowsFromConfig(data) {
  if (Array.isArray(data?.terrain) && Number.isFinite(data.width) && Number.isFinite(data.height)) {
    const glyphs = ASCII_TERRAIN_GLYPHS;
    const rows = [];
    for (let y = 0; y < data.height; y += 1) {
      let row = "";
      for (let x = 0; x < data.width; x += 1) {
        row += glyphs[data.terrain[y * data.width + x]] || ".";
      }
      rows.push(row);
    }
    return { width: data.width, height: data.height, layoutRows: rows };
  }
  const tiles = [];
  return {
    width: Number(data?.width) || tiles[0]?.length || 0,
    height: Number(data?.height) || tiles.length,
    layoutRows: tiles,
  };
}

export async function createVisualizationSnapshot({
  mode,
  tick,
  runId,
  simConfig,
  initialState,
  frames,
  clock = null,
}) {
  // PX.3 extended to the render layer. This used to read the wall clock twice —
  // `Date.now()` in the artifact ID and `new Date().toISOString()` in
  // `createdAt` — which put non-reproducible values into a persisted artifact:
  // the same run, replayed, produced a different snapshot ID. PX.3 established
  // that a persona's clock is injected and never defaulted, but only personas
  // were converted; the runner and this render path kept defaulting, so the rule
  // held everywhere a guard looked and nowhere else.
  //
  // The ID is now derived from what identifies the snapshot — its run and tick —
  // rather than from when it happened to be built. `createdAt` comes from the
  // injected clock, and is omitted rather than invented when none is supplied.
  const meta = {
    id: `vs_${runId}_t${tick}`,
    runId,
    producedBy: "ak-tick",
  };
  if (typeof clock === "function") {
    meta.createdAt = clock();
  }

  const actorPositions = computeActorPositions(initialState, frames, tick);
  const actorDetails = buildActorDetails(initialState, actorPositions);

  if (mode === "image") {
    return {
      schema: VISUALIZATION_SNAPSHOT_SCHEMA,
      schemaVersion: VISUALIZATION_SNAPSHOT_VERSION,
      meta,
      mode: "image",
      tick,
      runId,
      visualizationDataUri: null,
      actorDetails,
    };
  }

  // ASCII mode
  const { width, height, layoutRows } = layoutRowsFromConfig(simConfig.layout.data);

  const hazardRows = buildBlankGrid(width, height);
  const resourceRows = buildBlankGrid(width, height);
  const delverRows = buildBlankGrid(width, height);
  const wardenRows = buildBlankGrid(width, height);
  const presentation = initialState.presentation || {};

  for (const actor of initialState.actors || []) {
    const pos = actorPositions.get(actor.id) || actor.position;
    const category = inferKind(actor, presentation);
    if (category === "hazard") markPosition(hazardRows, pos.x, pos.y, ASCII_ENTITY_GLYPHS.hazard);
    else if (category === "resource") markPosition(resourceRows, pos.x, pos.y, ASCII_ENTITY_GLYPHS.resource);
    else if (category === "warden") markPosition(wardenRows, pos.x, pos.y, ASCII_ENTITY_GLYPHS.warden);
    else if (category === "delver") markPosition(delverRows, pos.x, pos.y, ASCII_ENTITY_GLYPHS.delver);
  }

  const asciiRows = layoutRows.map((layoutRow, y) => {
    return layoutRow.split("").map((layoutChar, x) => {
      if (delverRows[y][x] !== " ") return delverRows[y][x];
      if (wardenRows[y][x] !== " ") return wardenRows[y][x];
      if (hazardRows[y][x] !== " ") return hazardRows[y][x];
      if (resourceRows[y][x] !== " ") return resourceRows[y][x];
      return layoutChar;
    }).join("");
  });

  return {
    schema: VISUALIZATION_SNAPSHOT_SCHEMA,
    schemaVersion: VISUALIZATION_SNAPSHOT_VERSION,
    meta,
    mode: "ascii",
    tick,
    runId,
    ascii: addCoordinateLegend(asciiRows),
    layers: {
      layout: layoutRows.join("\n"),
      hazards: hazardRows.join("\n"),
      resources: resourceRows.join("\n"),
      delvers: delverRows.join("\n"),
      wardens: wardenRows.join("\n"),
    },
    actorDetails,
  };
}
