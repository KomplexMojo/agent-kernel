import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createVisualizationSnapshot } from "../../runtime/src/render/visualization-snapshot.js";
import { TICK_CURSOR_SCHEMA } from "../../runtime/src/contracts/artifacts.ts";

const DEFAULT_ARTIFACTS_DIR = "artifacts";

// #143 — this always resolved to the canonical <cwd>/artifacts/runs/<runId> layout, ignoring the
// MCP server's own "remembered outDir per runId" mechanism that ak_create/ak_run/ak_show/
// ak_runs_list already use when outDir is left to default. A run created via that default (the
// MCP README's own "most common agent loop") was invisible to ak_show_state/ak_tick_forward/
// ak_tick_backward, which reported "run directory not found" even though ak_show/ak_runs_list
// found the same run immediately. `runDirOverride`, when supplied, is used verbatim instead of
// the canonical-layout guess -- the MCP server (server.mjs's resolveRememberedRunDirOverride)
// passes one through when it has a remembered outDir for this runId; the plain CLI (`ak tick`,
// which has no session/remembered-run concept at all) never supplies one, so its behavior is
// unchanged.
export function resolveRunDir(runId, runDirOverride) {
  if (runDirOverride) return runDirOverride;
  const artifactsDir = process.env.AK_ARTIFACTS_DIR
    ? process.env.AK_ARTIFACTS_DIR
    : join(process.cwd(), DEFAULT_ARTIFACTS_DIR);
  return join(artifactsDir, "runs", runId);
}

export async function readMaxTick(runDir) {
  const summaryPath = join(runDir, "run", "run-summary.json");
  if (existsSync(summaryPath)) {
    try {
      const summary = JSON.parse(await readFile(summaryPath, "utf8"));
      const ticks = summary?.metrics?.ticks;
      if (Number.isFinite(ticks) && ticks > 0) return ticks;
    } catch {}
  }
  const framesPath = join(runDir, "run", "tick-frames.json");
  if (existsSync(framesPath)) {
    try {
      const frames = JSON.parse(await readFile(framesPath, "utf8"));
      if (Array.isArray(frames)) return frames.length;
    } catch {}
  }
  return null;
}

export async function readCursor(runDir) {
  const cursorPath = join(runDir, "session", "cursor.json");
  if (!existsSync(cursorPath)) return null;
  try {
    const cursor = JSON.parse(await readFile(cursorPath, "utf8"));
    return {
      tick: typeof cursor.tick === "number" ? cursor.tick : 0,
      maxTick: cursor.maxTick,
    };
  } catch {
    return null;
  }
}

export async function writeCursor(runDir, runId, tick, maxTick) {
  const sessionDir = join(runDir, "session");
  await mkdir(sessionDir, { recursive: true });
  const cursor = {
    schema: TICK_CURSOR_SCHEMA,
    schemaVersion: 1,
    meta: {
      id: `cursor_${runId}`,
      runId,
      createdAt: new Date().toISOString(),
      producedBy: "ak-tick",
    },
    runId,
    tick,
    maxTick,
  };
  await writeFile(
    join(sessionDir, "cursor.json"),
    `${JSON.stringify(cursor, null, 2)}\n`,
    "utf8",
  );
}

export async function readTickFrame(runDir, tick) {
  if (!tick || tick <= 0) return null;
  const framesPath = join(runDir, "run", "tick-frames.json");
  if (!existsSync(framesPath)) return null;
  try {
    const frames = JSON.parse(await readFile(framesPath, "utf8"));
    if (!Array.isArray(frames)) return null;
    // Return the last phase frame for this simulation tick (typically 'summarize').
    // Real runs emit multiple phase frames per tick; cursor represents simulation tick, not array index.
    const forTick = frames.filter((f) => f.tick === tick);
    return forTick[forTick.length - 1] ?? null;
  } catch {
    return null;
  }
}

const VALID_VISUALIZATION_MODES = ["ascii", "image"];

export function validateVisualizationMode(mode) {
  if (!VALID_VISUALIZATION_MODES.includes(mode)) {
    return { ok: false, error: `visualization must be ascii or image, got: ${mode}` };
  }
  return { ok: true };
}

function resolveBuildArtifact(runDir, filename) {
  for (const subdir of ["build", "create", "configurator"]) {
    const p = join(runDir, subdir, filename);
    if (existsSync(p)) return p;
  }
  return null;
}

// #147 — this used to accept a single `tickFrame` (the last phase-frame for the requested tick,
// i.e. `summarize`, which always carries acceptedActions: [] by construction) and hand it straight
// to createVisualizationSnapshot/buildPngDataUri, which only overlaid that one frame. The actual
// accepted moves live on that tick's earlier `apply` phase-frame, so the overlay never applied and
// every actor rendered frozen at spawn for the whole run. Reads the full frame history instead, so
// both the ascii/actorDetails path (createVisualizationSnapshot) and the image path
// (buildPngDataUri, via resolveActorPositionsAtTick — the same cumulative replay renderAscii()
// already used correctly) can accumulate every accepted move up to the requested tick.
export async function buildVisualizationSnapshot(runDir, runId, tick, mode) {
  const simConfigPath = resolveBuildArtifact(runDir, "sim-config.json");
  const initialStatePath = resolveBuildArtifact(runDir, "initial-state.json");
  if (!simConfigPath || !initialStatePath) return null;
  try {
    const [simConfig, initialState] = await Promise.all([
      readFile(simConfigPath, "utf8").then(JSON.parse),
      readFile(initialStatePath, "utf8").then(JSON.parse),
    ]);
    const framesPath = join(runDir, "run", "tick-frames.json");
    let frames = null;
    if (existsSync(framesPath)) {
      try {
        frames = JSON.parse(await readFile(framesPath, "utf8"));
      } catch {
        frames = null;
      }
    }
    const snap = await createVisualizationSnapshot({ mode, tick, runId, simConfig, initialState, frames });
    if (mode === "image" && snap) {
      const dataUri = await buildPngDataUri(simConfig, initialState, frames, tick, runDir);
      // #144 — a data URI this size (443,790 characters on a trivial one-room, one-actor run in
      // the session that found this) inlined into the MCP tool result blows the caller's
      // tool-result token limit; `ascii` mode worked at a fraction of the size because it never
      // carries image bytes. Write the PNG to a file instead, the same convention every other
      // artifact-producing ak_* tool already follows, and hand back the path — a caller reads the
      // file directly rather than receiving its bytes inline.
      snap.visualizationDataUri = null;
      snap.visualizationPath = await writePngToFile(dataUri, runDir, tick);
    }
    return snap;
  } catch {
    return null;
  }
}

async function writePngToFile(dataUri, runDir, tick) {
  if (!dataUri) return null;
  const base64 = dataUri.replace(/^data:image\/png;base64,/, "");
  const sessionDir = join(runDir, "session");
  await mkdir(sessionDir, { recursive: true });
  const path = join(sessionDir, `visualization-tick-${tick}.png`);
  await writeFile(path, Buffer.from(base64, "base64"));
  return path;
}

async function buildPngDataUri(simConfig, initialState, frames, tick, runDir) {
  const { renderBoardWithResourceBundle, encodeRgbaToPng } = await import(
    "../../runtime/src/render/resource-bundle.js"
  );
  const tiles = simConfig.layout?.data?.tiles;
  if (!Array.isArray(tiles) || tiles.length === 0) return null;

  // Load the saved resource bundle if one exists — assets with dataUri are used directly;
  // missing assets fall back to generated sprites in renderBoardWithResourceBundle.
  let resourceBundle = null;
  const bundlePath = resolveBuildArtifact(runDir, "resource-bundle.json");
  if (bundlePath) {
    try {
      resourceBundle = JSON.parse(await readFile(bundlePath, "utf8"));
    } catch {
      // fall through to generated default sprites
    }
  }

  // Cumulative replay of every accepted move up to `tick`, not just one frame's overlay.
  const posOverrides = resolveActorPositionsAtTick(initialState, frames, tick);
  // Spread full actor data so renderBoardWithResourceBundle can resolve affinity/motivation sprites.
  const renderActors = (initialState.actors || []).map((actor) => {
    const pos = posOverrides.get(actor.id) || actor.position;
    return { ...actor, position: { x: pos.x, y: pos.y } };
  });

  const result = await renderBoardWithResourceBundle({
    tiles,
    actors: renderActors,
    floorAffinityHazards: simConfig.hazards || simConfig.layout?.data?.hazards || [],
    resourceBundle,
  });
  if (!result.ok) return null;
  const pngBytes = encodeRgbaToPng({ width: result.width, height: result.height, pixels: result.pixels });
  return `data:image/png;base64,${Buffer.from(pngBytes).toString("base64")}`;
}

const ACTOR_GLYPH = "@";

/**
 * AM.0b — actor positions as of `tick`, replayed from the run's own record.
 *
 * Positions start at the initial state and advance to each accepted `move`
 * action's recorded destination, frame by frame, stopping at the requested tick.
 * These are facts the run already wrote down, not a re-simulation: no rule is
 * evaluated and no action is re-validated here, so this stays presentation.
 *
 * Only ACCEPTED moves are followed. Since AM.1 a move core refused is recorded
 * in `preCoreRejections` instead, so a rejected move no longer moves the glyph —
 * which is the whole reason this can be trusted to show what actually happened.
 */
function resolveActorPositionsAtTick(initialState, frames, tick) {
  const positions = new Map();
  const actors = Array.isArray(initialState?.actors) ? initialState.actors : [];
  actors.forEach((actor) => {
    if (!actor?.id || !Number.isFinite(actor.position?.x) || !Number.isFinite(actor.position?.y)) return;
    positions.set(String(actor.id), { x: actor.position.x, y: actor.position.y });
  });
  if (!Array.isArray(frames)) return positions;

  const limit = Number.isFinite(tick) ? tick : Infinity;
  for (const frame of frames) {
    if (Number.isFinite(frame?.tick) && frame.tick > limit) break;
    for (const action of Array.isArray(frame?.acceptedActions) ? frame.acceptedActions : []) {
      if (action?.kind !== "move") continue;
      const to = action.params?.to;
      const id = String(action.actorId || "");
      if (!id || !Number.isFinite(to?.x) || !Number.isFinite(to?.y)) continue;
      positions.set(id, { x: to.x, y: to.y });
    }
  }
  return positions;
}

/**
 * Render the run's grid at `tick`.
 *
 * Two defects fixed here (F11): this took no tick at all and rebuilt core from
 * `initial-state.json`, so `ak_show_state` reported **tick 0 whatever the
 * session cursor said**; and it called `renderBaseTiles`, which draws terrain
 * only, so **actors were never on the map**. A caller asking "show me the state"
 * got the starting terrain, every time, and nothing in the output said so.
 */
export async function renderAscii(runDir, tick = null) {
  const simConfigPath = resolveBuildArtifact(runDir, "sim-config.json");
  const initialStatePath = resolveBuildArtifact(runDir, "initial-state.json");
  if (!simConfigPath || !initialStatePath) return "";

  try {
    const [simConfig, initialState] = await Promise.all([
      readFile(simConfigPath, "utf8").then(JSON.parse),
      readFile(initialStatePath, "utf8").then(JSON.parse),
    ]);

    const { applySimConfigToCore, applyInitialStateToCore } = await import(
      "../../runtime/src/runner/core-setup.mjs"
    );
    const { createCore, renderBaseTiles } = await import("../../core-ts/src/index.ts");

    const core = createCore();
    const layoutResult = applySimConfigToCore(core, simConfig);
    if (!layoutResult.ok) return "";

    const actorResult = applyInitialStateToCore(core, initialState, {
      spawn: layoutResult.spawn,
    });
    if (!actorResult.ok) return "";

    const rows = renderBaseTiles(core).map((row) => row.split(""));

    const framesPath = join(runDir, "run", "tick-frames.json");
    let frames = null;
    if (existsSync(framesPath)) {
      try {
        const parsed = JSON.parse(await readFile(framesPath, "utf8"));
        frames = Array.isArray(parsed?.frames) ? parsed.frames : parsed;
      } catch {
        frames = null;
      }
    }

    const positions = resolveActorPositionsAtTick(initialState, frames, tick);
    for (const { x, y } of positions.values()) {
      if (y >= 0 && y < rows.length && x >= 0 && x < rows[y].length) {
        rows[y][x] = ACTOR_GLYPH;
      }
    }

    return rows.map((row) => row.join("")).join("\n");
  } catch {
    return "";
  }
}
