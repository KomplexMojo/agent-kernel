#!/usr/bin/env node
/**
 * ak-maze — play an agent-kernel level in the terminal.
 *
 * The terminal is the only thing this file owns: argument parsing, raw-mode
 * keypresses, redraws. See README.md for usage.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createGame } from "./game.js";
import { HELP_LINES, WATCH_HELP_LINES, intentForKey, splitKeys, watchIntentForKey } from "./keymap.js";
import {
  listBundledLevels,
  loadBundledLevel,
  loadBundledLevels,
  loadLevelFromFiles,
  loadLevelFromRunDir,
  loadRunFromDir,
} from "./levels.js";
import { hudLine } from "./screen.js";
import { createWatch } from "./watch.js";
import { DEFAULT_REALTIME_MS, REALTIME_TOGGLE_KEY, parseRealtimeMs, realtimeBeat, realtimeLine } from "./realtime.js";

const USAGE = `Usage: ak-maze [options]

  --level <name>          start at a bundled level (default: the first)
  --run <dir>             play the level from an ak run directory
  --sim-config <path>     play a SimConfig artifact...
  --initial-state <path>  ...with this InitialState artifact
  --keys <keys>           non-interactive: apply these keys, print the final screen, exit
  --record <path>         on exit, write the played commands as a CapturedInputArtifact
  --replay <path>         first re-run a recorded game on its level, then continue
  --json                  with --keys: print {ok, level, turns, status, screen, warnings?} as JSON
  --list                  list bundled levels
  --color                 colour even when output is not a terminal
  --no-color              plain text output (also: NO_COLOR set in the environment)
  --no-fog                debug: show the whole map (play is always under fog of war)
  --realtime <ms>         interactive play: a turn passes every <ms> while you wait (t toggles;
                          turn-based by default)
  --watch                 with --run: watch the run \`ak run\` recorded there, tick by tick
  --tick <n>              with --watch: open at this tick (default 0)
  --no-help               start with the key help hidden (? shows it)
  --session <path>        a game kept in a file across calls: replay it if it exists, then
                          --actor, --commands and --keys, then save it back (with --json, the
                          result adds active, party and inSight). A new session needs a level
  --actor <id|label>      play this party member (a user_controlled actor) first; free
  --commands <json>       a JSON array of commands to act first, each { kind, params?, actorId? },
                          { kind: "switch", actorId }, { kind: "order", actorId, strategy } (a turn)
                          or { kind: "advance", ticks?, until? } (until: orders_done | contact);
                          actors and targets may be labels (D1, W2)
  -h, --help              show this help

${HELP_LINES.join("\n")}

Watching a run:
${WATCH_HELP_LINES.join("\n")}`;

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
      case "--watch": options.watch = true; break;
      case "--no-help": options.showHelp = false; break;
      case "--session": options.sessionPath = next(); break;
      case "--actor": options.actor = next(); break;
      case "--commands": {
        const text = next();
        let commands;
        try {
          commands = JSON.parse(text);
        } catch {
          throw new Error(`--commands needs a JSON array, got ${text}`);
        }
        if (!Array.isArray(commands)) throw new Error("--commands needs a JSON array of commands");
        options.commands = commands;
        break;
      }
      case "--tick": {
        const value = next();
        if (!/^\d+$/.test(value)) throw new Error(`--tick needs a whole number, got ${value}`);
        options.tick = Number(value);
        break;
      }
      case "--color": options.color = "always"; break;
      case "--realtime": options.realtimeMs = parseRealtimeMs(next()); break;
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

/**
 * How many colours to write (#286). 24-bit when the terminal says it takes it
 * (`COLORTERM=truecolor|24bit`) or when the output is captured rather than shown
 * (not a terminal); otherwise xterm-256, which every colour terminal reads —
 * macOS Terminal does not set COLORTERM and misreads 24-bit codes.
 */
export function colorDepth({ isTTY = false, env = {} } = {}) {
  if (/^(truecolor|24bit)$/i.test(String(env.COLORTERM || ""))) return "truecolor";
  return isTTY ? "256" : "truecolor";
}

/** The `color` a screen takes: false, or the depth to write it at. */
export function resolveColor(options, terminal) {
  return shouldUseColor(options, terminal) ? colorDepth(terminal) : false;
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

/**
 * Write the game's played commands to `path` (#204); the clock is read here, at the edge.
 * `source` (where the level came from) lets `--session` reopen it without level options.
 */
export function recordGame(game, path, { now = new Date(), source } = {}) {
  const createdAt = now.toISOString();
  const recorded = game.captureInput({ id: `play_capture_${now.getTime()}`, runId: `play_${now.getTime()}`, createdAt });
  const capture = source ? { ...recorded, source: { ...recorded.source, request: { ...recorded.source.request, source } } } : recorded;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(capture, null, 2)}\n`);
}

/** The level a capture was recorded on, so `--replay` alone picks it. */
export function readCapture(path) {
  const capture = JSON.parse(readFileSync(path, "utf8"));
  return { capture, level: capture?.source?.request?.level, source: capture?.source?.request?.source };
}

/** Where the level came from, with absolute paths, as a session file keeps it. */
export function levelSource(options) {
  if (options.runDir) return { runDir: resolve(options.runDir) };
  if (options.simConfigPath || options.initialStatePath) {
    return { simConfigPath: resolve(options.simConfigPath), initialStatePath: resolve(options.initialStatePath) };
  }
  return options.level ? { level: options.level } : null;
}

const LEVEL_OPTIONS = ["level", "runDir", "simConfigPath", "initialStatePath"];

/** Feed a key string through the game without a terminal; returns the final screen. */
export async function runScripted(game, keys, { color = false, keyIntent = intentForKey } = {}) {
  for (const key of splitKeys(keys)) {
    if ((await game.handle(keyIntent(key))).quit) break;
  }
  return game.screen({ color });
}

function runInteractive(game, { color, recordPath, keyIntent = intentForKey, realtimeMs = null, realtimeKeys = true }) {
  const { stdin, stdout } = process;
  // #291: turn-based unless --realtime or `t` switches real time on.
  const realtime = { on: realtimeMs !== null, intervalMs: realtimeMs ?? DEFAULT_REALTIME_MS, timer: null };
  const draw = () => stdout.write(`\u001b[2J\u001b[H${game.screen({ color })}\n${realtimeKeys ? `\n${realtimeLine(realtime)}\n` : ""}`);
  const restore = () => {
    if (realtime.timer) clearInterval(realtime.timer);
    if (stdin.isTTY) stdin.setRawMode(false);
    stdout.write("\u001b[?25h");
  };
  process.on("exit", restore);
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  stdout.write("\u001b[?25l");
  // Keys and real-time beats are applied strictly in order on one chain.
  let pending = Promise.resolve();
  const schedule = () => {
    if (realtime.timer) clearInterval(realtime.timer);
    realtime.timer = realtime.on ? setInterval(() => {
      pending = pending.then(async () => { if (await realtimeBeat(game)) draw(); });
    }, realtime.intervalMs) : null;
  };
  schedule();
  draw();
  stdin.on("data", (chunk) => {
    pending = pending.then(async () => {
      for (const key of splitKeys(chunk)) {
        if (realtimeKeys && key === REALTIME_TOGGLE_KEY) {
          realtime.on = !realtime.on;
          schedule();
          continue;
        }
        if ((await game.handle(keyIntent(key))).quit) {
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
  if (options.watch) return watch(options);
  if (options.sessionPath) return session(options);
  if (options.actor !== undefined || options.commands !== undefined) {
    console.error(`--actor and --commands need --session.\n\n${USAGE}`);
    return 2;
  }
  if (options.tick !== undefined) {
    console.error(`--tick needs --watch.\n\n${USAGE}`);
    return 2;
  }
  let game;
  try {
    const recorded = options.replayPath ? readCapture(options.replayPath) : null;
    // A bundled-level capture names its level; an explicit --level/--run still wins.
    const levelOptions = recorded?.level && !options.level && !options.runDir && !options.simConfigPath
      ? { ...options, level: recorded.level }
      : options;
    game = await createGame({ ...resolveLevels(levelOptions), fog: options.fog, showHelp: options.showHelp !== false });
    if (recorded) await game.replay(recorded.capture);
  } catch (error) {
    console.error(error.message);
    return 1;
  }
  // Reported, not fixed: the level is played as written.
  const { warnings } = game.state();
  for (const warning of warnings) console.error(`warning: ${warning}`);
  if (options.keys !== undefined || (options.replayPath && (options.json || !process.stdin.isTTY))) {
    const color = options.json ? options.color === "always" && "truecolor" : resolveColor(options, { isTTY: process.stdout.isTTY, env: process.env });
    const screen = await runScripted(game, options.keys ?? "", { color });
    if (options.recordPath) recordGame(game, options.recordPath);
    if (options.json) {
      const { levelName, turns, status } = game.state();
      console.log(JSON.stringify({ ok: true, level: levelName, turns, status, screen, ...(warnings.length ? { warnings } : {}) }));
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
  runInteractive(game, { color: resolveColor(options, { isTTY: process.stdout.isTTY, env: process.env }), recordPath: options.recordPath, realtimeMs: options.realtimeMs ?? null });
  return null; // keeps running until the player quits
}

/**
 * `--session`: one game kept in a file across calls. An existing file is replayed on the
 * level it names; then the seat changes (--actor), structured commands and keys are
 * applied, and the file is written back. Nothing else is kept between calls.
 */
async function session(options) {
  const conflicts = ["recordPath", "replayPath", "watch"].filter((key) => options[key] !== undefined);
  if (conflicts.length > 0) {
    console.error("--session keeps its own record; it does not take --record, --replay or --watch.");
    return 2;
  }
  const exists = existsSync(options.sessionPath);
  const named = LEVEL_OPTIONS.some((key) => options[key] !== undefined);
  if (exists && named) {
    console.error(`${options.sessionPath} already holds a game; continue it without level options.`);
    return 2;
  }
  let game;
  let source;
  try {
    const recorded = exists ? readCapture(options.sessionPath) : null;
    source = recorded ? (recorded.source ?? (recorded.level ? { level: recorded.level } : null)) : levelSource(options);
    const levelOptions = { ...options, ...(source?.runDir ? { runDir: source.runDir } : {}),
      ...(source?.simConfigPath ? { simConfigPath: source.simConfigPath, initialStatePath: source.initialStatePath } : {}),
      ...(source?.level ? { level: source.level } : {}) };
    game = await createGame({ ...resolveLevels(levelOptions), fog: options.fog, showHelp: options.showHelp !== false });
    if (recorded) await game.replay(recorded.capture);
  } catch (error) {
    console.error(error.message);
    return 1;
  }
  const results = [];
  if (options.actor !== undefined) results.push(game.switchTo(options.actor));
  try {
    for (const entry of options.commands ?? []) results.push(await game.command(entry));
  } catch (error) {
    console.error(error.message);
    return 2;
  }
  const color = options.json ? options.color === "always" && "truecolor" : resolveColor(options, { isTTY: process.stdout.isTTY, env: process.env });
  const screen = await runScripted(game, options.keys ?? "", { color });
  recordGame(game, options.sessionPath, { source: source ?? undefined });
  if (!options.json) {
    console.log(screen);
    return 0;
  }
  const { levelName, turns, status, active, party, orders, warnings, message } = game.state();
  const view = game.view();
  const inSight = [...(view.actors || []), ...(view.hazards || [])]
    .map((actor) => ({ label: actor.label, id: actor.id, role: actor.role, position: actor.position }));
  console.log(JSON.stringify({
    ok: true, session: resolve(options.sessionPath), level: levelName, turns, status, active, party,
    ...(orders.length ? { orders } : {}), inSight,
    ...(results.length ? { results } : {}), ...(message ? { message } : {}), hud: hudLine(view, { turns }), screen,
    ...(warnings.length ? { warnings } : {}),
  }));
  return 0;
}

/** `--watch`: a recorded run, drawn with the game's screen; keys step through its ticks. */
async function watch(options) {
  if (!options.runDir) {
    console.error(`--watch needs --run <dir> (an \`ak run\` output directory).\n\n${USAGE}`);
    return 2;
  }
  const unsupported = ["level", "simConfigPath", "initialStatePath", "recordPath", "replayPath"].filter((key) => options[key] !== undefined);
  if (unsupported.length > 0 || options.fog === false) {
    console.error("--watch shows a recorded run as it happened: it takes --run, --tick, --keys, --json and the colour options only.");
    return 2;
  }
  let viewer;
  try {
    viewer = createWatch({ run: loadRunFromDir(options.runDir), tick: options.tick ?? 0, showHelp: options.showHelp !== false });
  } catch (error) {
    console.error(error.message);
    return 1;
  }
  if (options.keys !== undefined || options.json || !process.stdin.isTTY) {
    const color = options.json ? options.color === "always" && "truecolor" : resolveColor(options, { isTTY: process.stdout.isTTY, env: process.env });
    const screen = await runScripted(viewer, options.keys ?? "", { color, keyIntent: watchIntentForKey });
    if (options.json) {
      console.log(JSON.stringify({ ok: true, ...viewer.state(), screen }));
    } else {
      console.log(screen);
    }
    return 0;
  }
  runInteractive(viewer, { color: resolveColor(options, { isTTY: process.stdout.isTTY, env: process.env }), keyIntent: watchIntentForKey, realtimeKeys: false });
  return null;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().then((code) => {
    if (code !== null) process.exitCode = code;
  });
}
