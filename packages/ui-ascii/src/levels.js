/**
 * Level loading: file IO only. A level is a SimConfig + InitialState artifact
 * pair; this module finds and parses them and never interprets their contents.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { INITIAL_STATE_SCHEMA, SIM_CONFIG_SCHEMA } from "../../runtime/src/contracts/artifacts.ts";

export const BUNDLED_LEVELS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../levels");

const SIM_CONFIG_SUFFIX = ".sim-config.json";
const INITIAL_STATE_SUFFIX = ".initial-state.json";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Bundled level names, in play order (file names sort into it). */
export function listBundledLevels(dir = BUNDLED_LEVELS_DIR) {
  return readdirSync(dir)
    .filter((name) => name.endsWith(SIM_CONFIG_SUFFIX))
    .map((name) => name.slice(0, -SIM_CONFIG_SUFFIX.length))
    .filter((name) => existsSync(join(dir, `${name}${INITIAL_STATE_SUFFIX}`)))
    .sort();
}

export function loadBundledLevel(name, dir = BUNDLED_LEVELS_DIR) {
  const simConfigPath = join(dir, `${name}${SIM_CONFIG_SUFFIX}`);
  const initialStatePath = join(dir, `${name}${INITIAL_STATE_SUFFIX}`);
  if (!existsSync(simConfigPath) || !existsSync(initialStatePath)) {
    throw new Error(`Unknown level "${name}". Bundled levels: ${listBundledLevels(dir).join(", ")}`);
  }
  return { name, simConfig: readJson(simConfigPath), initialState: readJson(initialStatePath) };
}

export function loadBundledLevels(dir = BUNDLED_LEVELS_DIR) {
  return listBundledLevels(dir).map((name) => loadBundledLevel(name, dir));
}

// #514: the budget receipt and price list an `ak create` build leaves beside its level, for the
// analysis console. Absent for bundled levels; never read for play.
function readCosting(dir) {
  const read = (file) => (existsSync(join(dir, file)) ? readJson(join(dir, file)) : null);
  const costing = { receipt: read("budget-receipt.json"), prices: read("price-list.json") };
  return costing.receipt || costing.prices ? { costing } : {};
}

export function loadLevelFromFiles({ simConfigPath, initialStatePath, name } = {}) {
  if (!simConfigPath || !initialStatePath) {
    throw new Error("Both --sim-config and --initial-state are required together");
  }
  return {
    name: name || basename(simConfigPath).replace(/\.json$/, ""),
    simConfig: readJson(simConfigPath),
    initialState: readJson(initialStatePath),
    ...readCosting(dirname(simConfigPath)),
  };
}

/**
 * Where an `ak` output directory keeps its build artifacts: `ak create --out-dir`
 * writes them at the top level; run directories keep them under one of these
 * subdirectories, depending on which command produced them.
 */
const RUN_DIR_BUILD_SUBDIRS = ["", "build", "create", "configurator"];

export function loadLevelFromRunDir(runDir) {
  for (const subdir of RUN_DIR_BUILD_SUBDIRS) {
    const simConfigPath = join(runDir, subdir, "sim-config.json");
    const initialStatePath = join(runDir, subdir, "initial-state.json");
    if (existsSync(simConfigPath) && existsSync(initialStatePath)) {
      return loadLevelFromFiles({ simConfigPath, initialStatePath, name: basename(resolve(runDir)) });
    }
  }
  throw new Error(`No sim-config.json + initial-state.json in ${runDir} or its ${RUN_DIR_BUILD_SUBDIRS.filter(Boolean).join("/, ")}/ subdirectory`);
}

// A run's own bundle (`ak run` writes one) carries the level it ran and its frames.
function levelFromBundle(bundle, name) {
  const artifacts = Array.isArray(bundle?.artifacts) ? bundle.artifacts : [];
  const simConfig = artifacts.find((artifact) => artifact?.schema === SIM_CONFIG_SCHEMA);
  const initialState = artifacts.find((artifact) => artifact?.schema === INITIAL_STATE_SCHEMA);
  return simConfig && initialState ? { name, simConfig, initialState } : null;
}

/**
 * A recorded run for `--watch`: its level and its tick frames. `ak run --out-dir`
 * writes `tick-frames.json` and `bundle.json` at the top level; a run directory
 * under `artifacts/runs/<id>` keeps them under `run/`, beside the build in `create/`.
 */
export function loadRunFromDir(runDir) {
  const name = basename(resolve(runDir));
  for (const subdir of ["", "run"]) {
    const framesPath = join(runDir, subdir, "tick-frames.json");
    const bundlePath = join(runDir, subdir, "bundle.json");
    const bundle = existsSync(bundlePath) ? readJson(bundlePath) : null;
    const recorded = existsSync(framesPath) ? readJson(framesPath) : bundle?.tickFrames;
    const frames = Array.isArray(recorded?.frames) ? recorded.frames : recorded;
    if (!Array.isArray(frames)) continue;
    const level = levelFromBundle(bundle, name) ?? loadLevelFromRunDir(runDir);
    return { ...level, name, frames };
  }
  throw new Error(`No recorded run in ${runDir}: expected tick-frames.json there or under run/ (an \`ak run\` output directory)`);
}
