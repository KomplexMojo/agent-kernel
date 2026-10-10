/**
 * Level loading: file IO only. A level is a SimConfig + InitialState artifact
 * pair; this module finds and parses them and never interprets their contents.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

export function loadLevelFromFiles({ simConfigPath, initialStatePath, name } = {}) {
  if (!simConfigPath || !initialStatePath) {
    throw new Error("Both --sim-config and --initial-state are required together");
  }
  return {
    name: name || basename(simConfigPath).replace(/\.json$/, ""),
    simConfig: readJson(simConfigPath),
    initialState: readJson(initialStatePath),
  };
}

/**
 * An `ak` run directory keeps its build artifacts under one of these
 * subdirectories, depending on which command produced it.
 */
const RUN_DIR_BUILD_SUBDIRS = ["build", "create", "configurator"];

export function loadLevelFromRunDir(runDir) {
  for (const subdir of RUN_DIR_BUILD_SUBDIRS) {
    const simConfigPath = join(runDir, subdir, "sim-config.json");
    const initialStatePath = join(runDir, subdir, "initial-state.json");
    if (existsSync(simConfigPath) && existsSync(initialStatePath)) {
      return loadLevelFromFiles({ simConfigPath, initialStatePath, name: basename(resolve(runDir)) });
    }
  }
  throw new Error(`No sim-config.json + initial-state.json under ${runDir}/{${RUN_DIR_BUILD_SUBDIRS.join(",")}}`);
}
