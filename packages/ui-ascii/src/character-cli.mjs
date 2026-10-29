#!/usr/bin/env node
/**
 * The character screen on a terminal: configure your own delver, priced live by the Allocator,
 * and get the `--delver` spec `ak create` builds the level from.
 *
 *   node packages/ui-ascii/src/character-cli.mjs --spec "<delver spec>" --budget 942 --out spec.txt
 *   node packages/ui-ascii/src/character-cli.mjs --spec "<spec>" --keys "ds+" --json
 *
 * Exit 0 with the spec written (to --out, else printed) when the player confirms, 3 when they
 * go back. `--keys` applies keys and prints the screen (or, with --json, { ok, view, screen, spec }).
 */
import { writeFileSync } from "node:fs";
import { createCharacterSheet } from "../../runtime/src/runner/character-sheet.js";
import { renderCharacterScreen, sheetIntentForKey } from "./character-screen.js";
import { splitKeys } from "./keymap.js";
import { colorDepth, shouldUseColor } from "./cli.mjs";

export const EXIT_BACK = 3;

const USAGE = `Usage: character-cli.mjs [--spec "<delver spec>"] [--budget <tokens>, default: the Allocator's delver pool] [--id <actor id>]
                         [--out <file>] [--keys <keys>] [--json] [--no-color]`;

export function parseArgs(argv) {
  const options = { spec: "", id: "hero", color: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${arg} needs a value`);
      return argv[++i];
    };
    switch (arg) {
      case "--spec": options.spec = next(); break;
      case "--budget": {
        const value = Number(next());
        if (!Number.isFinite(value) || value < 0) throw new Error("the token allowance needs a number");
        options.tokens = value;
        break;
      }
      case "--id": options.id = next(); break;
      case "--out": options.out = next(); break;
      case "--keys": options.keys = next(); break;
      case "--json": options.json = true; break;
      case "--no-color": options.color = false; break;
      case "-h": case "--help": options.help = true; break;
      default: throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

/** Apply keys to a sheet; stops when the player confirms or goes back. */
export function applyKeys(sheet, keys) {
  let outcome = { done: null };
  for (const key of splitKeys(keys)) {
    const intent = sheetIntentForKey(key);
    if (!intent) continue;
    outcome = sheet.apply(intent);
    if (outcome.done) break;
  }
  return outcome;
}

function finish(outcome, options) {
  if (outcome.done === "confirm") {
    if (options.out) writeFileSync(options.out, `${outcome.spec}\n`);
    else console.log(outcome.spec);
    return 0;
  }
  return EXIT_BACK;
}

function runInteractive(sheet, options, color) {
  const { stdin, stdout } = process;
  const draw = (note = "") => stdout.write(`\u001b[2J\u001b[H${renderCharacterScreen(sheet.view(), { color })}\n${note}`);
  const restore = () => { stdin.setRawMode(false); stdout.write("\u001b[?25h"); };
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  stdout.write("\u001b[?25l");
  draw();
  return new Promise((resolve) => {
    stdin.on("data", (chunk) => {
      for (const key of splitKeys(chunk)) {
        const intent = sheetIntentForKey(key);
        if (!intent) continue;
        const outcome = sheet.apply(intent);
        if (outcome.done) {
          restore();
          stdin.pause();
          stdout.write("\n");
          resolve(finish(outcome, options));
          return;
        }
        draw(outcome.refused ? `\n${outcome.refused.join("\n")}` : "");
      }
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
  const sheet = createCharacterSheet({ spec: options.spec, budgetTokens: options.tokens, id: options.id });
  const terminal = { isTTY: Boolean(process.stdout.isTTY), env: process.env };
  const color = shouldUseColor(options, terminal) ? colorDepth(terminal) : false;
  if (options.keys !== undefined) {
    const outcome = applyKeys(sheet, options.keys);
    const view = sheet.view();
    const screen = renderCharacterScreen(view, { color });
    if (options.json) console.log(JSON.stringify({ ok: view.ok, done: outcome.done, view, screen, spec: sheet.spec() }));
    else console.log(screen);
    return outcome.done ? finish(outcome, options) : 0;
  }
  if (!process.stdin.isTTY) {
    console.error("The character screen needs a terminal; use --keys to script it.");
    return 2;
  }
  return runInteractive(sheet, options, color);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main();
}
