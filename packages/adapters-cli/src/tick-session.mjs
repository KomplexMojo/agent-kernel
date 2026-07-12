import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createVisualizationSnapshot } from "../../runtime/src/render/visualization-snapshot.js";

const DEFAULT_ARTIFACTS_DIR = "artifacts";
const TICK_CURSOR_SCHEMA = "agent-kernel/TickCursor";

export function resolveRunDir(runId) {
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

export async function buildVisualizationSnapshot(runDir, runId, tick, tickFrame, mode) {
  const simConfigPath = resolveBuildArtifact(runDir, "sim-config.json");
  const initialStatePath = resolveBuildArtifact(runDir, "initial-state.json");
  if (!simConfigPath || !initialStatePath) return null;
  try {
    const [simConfig, initialState] = await Promise.all([
      readFile(simConfigPath, "utf8").then(JSON.parse),
      readFile(initialStatePath, "utf8").then(JSON.parse),
    ]);
    const snap = await createVisualizationSnapshot({ mode, tick, runId, simConfig, initialState, tickFrame });
    if (mode === "image" && snap) {
      snap.visualizationDataUri = await buildPngDataUri(simConfig, initialState, tickFrame, runDir);
    }
    return snap;
  } catch {
    return null;
  }
}

async function buildPngDataUri(simConfig, initialState, tickFrame, runDir) {
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

  // Apply move actions from tickFrame to get positions at this tick.
  const posOverrides = new Map();
  for (const action of (tickFrame?.acceptedActions || [])) {
    if (action.kind === "move" && action.params?.to) {
      posOverrides.set(action.actorId, { x: action.params.to.x, y: action.params.to.y });
    }
  }
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

export async function renderAscii(runDir) {
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

    return renderBaseTiles(core).join("\n");
  } catch {
    return "";
  }
}
