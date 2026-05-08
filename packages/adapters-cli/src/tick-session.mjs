import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Module is at packages/adapters-cli/src/ → project root is 3 dirs up
const PROJECT_WASM_PATH = resolve(__dirname, "../../..", "build", "core-as.wasm");

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

export async function renderAscii(runDir) {
  // Prefer env override, then module-relative project path, then cwd-relative fallback.
  const wasmPath = process.env.AK_WASM_PATH
    || (existsSync(PROJECT_WASM_PATH) ? PROJECT_WASM_PATH : null)
    || resolve(process.cwd(), "build", "core-as.wasm");
  if (!existsSync(wasmPath)) return "";

  const simConfigPath = join(runDir, "build", "sim-config.json");
  const initialStatePath = join(runDir, "build", "initial-state.json");
  if (!existsSync(simConfigPath) || !existsSync(initialStatePath)) return "";

  try {
    const [simConfig, initialState] = await Promise.all([
      readFile(simConfigPath, "utf8").then(JSON.parse),
      readFile(initialStatePath, "utf8").then(JSON.parse),
    ]);

    // Use the full bindings-ts core (has getMapWidth/renderBaseCellChar for rendering)
    const { loadCore } = await import("../../bindings-ts/src/core-as.js");
    const { applySimConfigToCore, applyInitialStateToCore } = await import(
      "../../runtime/src/runner/core-setup.mjs"
    );
    const { renderBaseTiles } = await import("../../bindings-ts/src/index.js");

    const wasmUrl = new URL(`file://${wasmPath}`);
    const core = await loadCore({ wasmUrl });
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
