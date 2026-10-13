/**
 * `ak play` — show or play a level in the terminal UI (`packages/ui-ascii`), or
 * watch a recorded run in it (`--watch`), which is also how `ak tick` and the MCP
 * tick tools draw a run.
 *
 * The terminal UI is its own program, so this adapter launches it as a child
 * process and never imports it: adapters-cli and ui-ascii are both outer-layer
 * consumers of runtime, and neither depends on the other. With keys (or for an
 * MCP caller) it runs the UI non-interactively and returns its JSON result;
 * without, it hands the terminal to the UI until the player quits.
 */
import { spawn, spawnSync } from "node:child_process";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const UI_ASCII_CLI = resolve(dirname(fileURLToPath(import.meta.url)), "../../../ui-ascii/src/cli.mjs");
const AK_CLI = resolve(dirname(fileURLToPath(import.meta.url)), "ak.mjs");

/** ui-ascii arguments naming the level; `source` is exactly one of its keys. */
export function levelArgs(source = {}) {
  if (source.dir) return ["--run", source.dir];
  if (source.simConfigPath || source.initialStatePath) {
    return ["--sim-config", source.simConfigPath, "--initial-state", source.initialStatePath];
  }
  if (source.level) return ["--level", source.level];
  return [];
}

function quote(arg) {
  return /^[\w./:=-]+$/.test(arg) ? arg : `'${String(arg).replace(/'/g, "'\\''")}'`;
}

/** The command a person runs in their own terminal to play this level, or to watch a run. */
export function launchCommand(source = {}, { cwd = process.cwd(), watch = false, tick } = {}) {
  const ak = relative(cwd, AK_CLI) || AK_CLI;
  const args = source.dir
    ? ["--dir", source.dir]
    : levelArgs(source);
  const watching = watch ? ["--watch", ...(Number.isInteger(tick) ? ["--tick", String(tick)] : [])] : [];
  return ["node", ak, "play", ...args, ...watching].map(quote).join(" ");
}

/** ui-ascii arguments for recording or replaying a game (#204). */
export function captureArgs({ recordPath, replayPath } = {}) {
  return [...(recordPath ? ["--record", recordPath] : []), ...(replayPath ? ["--replay", replayPath] : [])];
}

/**
 * Run the UI with `keys` and return its result:
 * `{ ok, level, turns, status, screen }`, or `{ ok: false, error }`.
 */
export function playAsciiScripted({ source, keys = "", color = false, fog = true, recordPath, replayPath }) {
  const result = spawnSync(
    process.execPath,
    [UI_ASCII_CLI, ...levelArgs(source), "--json", ...(color ? ["--color"] : []), ...(fog ? [] : ["--no-fog"]),
      ...captureArgs({ recordPath, replayPath }), "--keys", keys],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    return { ok: false, error: (result.stderr || result.stdout || `ui-ascii exited ${result.status}`).trim() };
  }
  return JSON.parse(result.stdout);
}

/** ui-ascii arguments for watching the run recorded in `runDir` from `tick`. */
export function watchArgs({ runDir, tick }) {
  return ["--run", runDir, "--watch", ...(Number.isInteger(tick) ? ["--tick", String(tick)] : [])];
}

/**
 * Watch a recorded run non-interactively: the UI's screen at `tick` after `keys`,
 * as `{ ok, tick, maxTick, level, status, screen }`, or `{ ok: false, error }`.
 * `help: false` leaves the key help off the screen (for a caller that is not a person at a terminal).
 */
export function watchAsciiScripted({ runDir, tick, keys = "", color = false, help = true }) {
  const result = spawnSync(
    process.execPath,
    [UI_ASCII_CLI, ...watchArgs({ runDir, tick }), "--json", ...(color ? ["--color"] : []), ...(help ? [] : ["--no-help"]), "--keys", keys],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    return { ok: false, error: (result.stderr || result.stdout || `ui-ascii exited ${result.status}`).trim() };
  }
  return JSON.parse(result.stdout);
}

/** Hand the terminal to the UI to watch a recorded run; resolves with its exit code. */
export function watchAsciiInteractive({ runDir, tick, color }) {
  const colorArgs = color === false ? ["--no-color"] : color === true ? ["--color"] : [];
  return new Promise((resolveExit, reject) => {
    const child = spawn(process.execPath, [UI_ASCII_CLI, ...watchArgs({ runDir, tick }), ...colorArgs], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => resolveExit(code ?? 1));
  });
}

/** Hand the terminal to the UI; resolves with its exit code. */
export function playAsciiInteractive({ source, color, fog = true, recordPath, replayPath }) {
  const colorArgs = [
    ...(color === false ? ["--no-color"] : color === true ? ["--color"] : []),
    ...(fog ? [] : ["--no-fog"]),
    ...captureArgs({ recordPath, replayPath }),
  ];
  return new Promise((resolveExit, reject) => {
    const child = spawn(process.execPath, [UI_ASCII_CLI, ...levelArgs(source), ...colorArgs], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => resolveExit(code ?? 1));
  });
}
