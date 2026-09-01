import { normalizeVitals } from "../contracts/domain-constants.js";

// M9: declared in contracts/artifacts.ts, re-exported here under the name importers use.
import { VISUALIZATION_SNAPSHOT_SCHEMA } from "../contracts/artifacts.ts";

export { VISUALIZATION_SNAPSHOT_SCHEMA };
export const VISUALIZATION_SNAPSHOT_VERSION = 1;

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
      if (action?.kind !== "move" || !action.params?.to) continue;
      positions.set(action.actorId, { x: action.params.to.x, y: action.params.to.y });
    }
  }
  return positions;
}

function inferKind(actor) {
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
  return initialState.actors.map((actor) => {
    const pos = actorPositions.get(actor.id) || actor.position;
    return {
      id: actor.id,
      kind: inferKind(actor),
      position: { x: pos.x, y: pos.y },
      affinities: collectAffinities(actor),
      vitals: normalizeVitals(actor.vitals),
      motivation: actor.motivation || actor.traits?.motivation || "unknown",
    };
  });
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
  const { width, height, tiles } = simConfig.layout.data;

  const layoutRows = tiles.map((row) => String(row));

  const hazardRows = buildBlankGrid(width, height);
  const resourceRows = buildBlankGrid(width, height);
  const delverRows = buildBlankGrid(width, height);
  const wardenRows = buildBlankGrid(width, height);

  for (const hazard of (simConfig.hazards || [])) {
    markPosition(hazardRows, hazard.x, hazard.y, "H");
  }

  for (const resource of (simConfig.resources || [])) {
    markPosition(resourceRows, resource.x, resource.y, "R");
  }

  for (const actor of initialState.actors) {
    const pos = actorPositions.get(actor.id) || actor.position;
    if (inferKind(actor) === "delver") {
      markPosition(delverRows, pos.x, pos.y, "D");
    } else {
      markPosition(wardenRows, pos.x, pos.y, "W");
    }
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
