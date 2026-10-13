#!/usr/bin/env node
/**
 * ak-maze — play an agent-kernel level in the terminal.
 *
 * The terminal is the only thing this file owns: argument parsing, raw-mode
 * keypresses, redraws. See README.md for usage.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createGame } from "./game.js";
import { HELP_LINES, intentForKey, splitKeys } from "./keymap.js";
import {
  listBundledLevels,
  loadBundledLevel,
  loadBundledLevels,
  loadLevelFromFiles,
  loadLevelFromRunDir,
} from "./levels.js";

const USAGE = `Usage: ak-maze [options]

  --level <name>          start at a bundled level (default: the first)
  --run <dir>             play the level from an ak run directory
  --sim-config <path>     play a SimConfig artifact...
  --initial-state <path>  ...with this InitialState artifact
  --keys <keys>           non-interactive: apply these keys, print the final screen, exit
  --record <path>         on exit, write the played commands as a CapturedInputArtifact
  --replay <path>         first re-run a recorded game on its level, then continue
  --json                  with --keys: print {ok, level, turns, status, screen} as JSON
  --list                  list bundled levels
  --color                 colour even when output is not a terminal
  --no-color              plain text output (also: NO_COLOR set in the environment)
  --no-fog                debug: show the whole map (play is always under fog of war)
  -h, --help              show this help

${HELP_LINES.join("\n")}`;

export function parseArgs(argv) {
  const options = { color: true, fog: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      i += 1;
      return value;
    };
    switch (arg) {
      // `pnpm run play:ascii -- --level x` forwards the separator itself.
      case "--": break;
      case "--level": options.level = next(); break;
      case "--run": options.runDir = next(); break;
      case "--sim-config": options.simConfigPath = next(); break;
      case "--initial-state": options.initialStatePath = next(); break;
      case "--keys": options.keys = next(); break;
      case "--record": options.recordPath = next(); break;
      case "--replay": options.replayPath = next(); break;
      case "--list": options.list = true; break;
      case "--json": options.json = true; break;
      case "--no-color": options.color = false; break;
      case "--no-fog": options.fog = false; break;
      case "--color": options.color = "always"; break;
      case "-h":
      case "--help": options.help = true; break;
      default: throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

/**
 * Colour by default on a terminal; never when NO_COLOR is set (no-color.org)
 * or --no-color is passed; --color forces it, e.g. for a piped --keys demo.
 */
export function shouldUseColor(options, { isTTY = false, env = {} } = {}) {
  if (options.color === false) return false;
  if (options.color === "always") return true;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  return Boolean(isTTY);
}

export function resolveLevels(options) {
  if (options.runDir) return { levels: [loadLevelFromRunDir(options.runDir)], startIndex: 0 };
  if (options.simConfigPath || options.initialStatePath) {
    return { levels: [loadLevelFromFiles(options)], startIndex: 0 };
  }
  const levels = loadBundledLevels();
  if (!options.level) return { levels, startIndex: 0 };
  loadBundledLevel(options.level); // throws a helpful error for an unknown name
  return { levels, startIndex: levels.findIndex((level) => level.name === options.level) };
}

/** Write the game's played commands to `path` (#204); the clock is read here, at the edge. */
export function recordGame(game, path, { now = new Date() } = {}) {
  const createdAt = now.toISOString();
  const capture = game.captureInput({ id: `play_capture_${now.getTime()}`, runId: `play_${now.getTime()}`, createdAt });
  writeFileSync(path, `${JSON.stringify(capture, null, 2)}\n`);
}

/** The level a capture was recorded on, so `--replay` alone picks it. */
export function readCapture(path) {
  const capture = JSON.parse(readFileSync(path, "utf8"));
  return { capture, level: capture?.source?.request?.level };
}

/** Feed a key string through the game without a terminal; returns the final screen. */
export async function runScripted(game, keys, { color = false } = {}) {
  for (const key of splitKeys(keys)) {
    if ((await game.handle(intentForKey(key))).quit) break;
  }
  return game.screen({ color });
}

function runInteractive(game, { color, recordPath }) {
  const { stdin, stdout } = process;
  const draw = () => stdout.write(`\u001b[2J\u001b[H${game.screen({ color })}\n`);
  const restore = () => {
    if (stdin.isTTY) stdin.setRawMode(false);
    stdout.write("\u001b[?25h");
  };
  process.on("exit", restore);
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  stdout.write("\u001b[?25l");
  draw();
  // Keys are applied strictly in order: each chunk waits for the previous one.
  let pending = Promise.resolve();
  stdin.on("data", (chunk) => {
    pending = pending.then(async () => {
      for (const key of splitKeys(chunk)) {
        if ((await game.handle(intentForKey(key))).quit) {
          if (recordPath) recordGame(game, recordPath);
          restore();
          stdout.write("\nBye.\n");
          process.exit(0);
        }
      }
      draw();
    });
  });
}

export async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`${error.message}\n\n${USAGE}`);
    return 2;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  if (options.list) {
    console.log(listBundledLevels().join("\n"));
    return 0;
  }
  let game;
  try {
    const recorded = options.replayPath ? readCapture(options.replayPath) : null;
    // A bundled-level capture names its level; an explicit --level/--run still wins.
    const levelOptions = recorded?.level && !options.level && !options.runDir && !options.simConfigPath
      ? { ...options, level: recorded.level }
      : options;
    game = await createGame({ ...resolveLevels(levelOptions), fog: options.fog });
    if (recorded) await game.replay(recorded.capture);
  } catch (error) {
    console.error(error.message);
    return 1;
  }
  if (options.keys !== undefined || (options.replayPath && (options.json || !process.stdin.isTTY))) {
    const color = options.json ? options.color === "always" : shouldUseColor(options, { isTTY: process.stdout.isTTY, env: process.env });
    const screen = await runScripted(game, options.keys ?? "", { color });
    if (options.recordPath) recordGame(game, options.recordPath);
    if (options.json) {
      const { levelName, turns, status } = game.state();
      console.log(JSON.stringify({ ok: true, level: levelName, turns, status, screen }));
    } else {
      console.log(screen);
    }
    return 0;
  }
  if (options.json) {
    console.error("--json needs --keys (an interactive game has no single result).");
    return 2;
  }
  if (!process.stdin.isTTY) {
    console.error("ak-maze needs an interactive terminal (or pass --keys).");
    return 1;
  }
  runInteractive(game, { color: shouldUseColor(options, { isTTY: process.stdout.isTTY, env: process.env }), recordPath: options.recordPath });
  return null; // keeps running until the player quits
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().then((code) => {
    if (code !== null) process.exitCode = code;
  });
}
