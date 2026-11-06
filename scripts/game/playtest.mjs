#!/usr/bin/env node
/**
 * Playtest: build a scenario through `ak create`, play it in the terminal with every turn
 * recorded, then write a report of what you noticed that can be pasted or attached as is.
 *
 *   node scripts/game/playtest.mjs                    list the scenarios
 *   node scripts/game/playtest.mjs <scenario> [--seed N] [-- <ak play options>]
 *   node scripts/game/playtest.mjs --open <report.md> [--keys keys]
 *
 * The seed picks the affinities ({A} the player's, {B} its opposite, {C}/{D} another opposed
 * pair, {T1}/{T2} two kinds whose affinity-table row carries a trait) and is printed, so a run is rebuilt exactly from scenario, seed and commit. The report
 * carries those three and a replay code (the recorded commands, gzipped), so `--open` rebuilds
 * the level and replays the game to where it ended, here or on any other checkout.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  AK_CLI as AK,
  affinitiesForSeed,
  createArgs,
  fillFocus,
  loadPlaytestScenarios,
  playerDelverSpec,
  traitsInPlay,
} from "../../packages/adapters-cli/src/cli/playtest-scenarios.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CHARACTER_CLI = join(ROOT, "packages/ui-ascii/src/character-cli.mjs");

/** The recorded commands as one pasteable line, and back. */
export function encodeReplay(commands) {
  return gzipSync(JSON.stringify(commands)).toString("base64url");
}
export function decodeReplay(code) {
  return JSON.parse(gunzipSync(Buffer.from(code, "base64url")).toString("utf8"));
}

function ak(args, { inherit = false } = {}) {
  const result = spawnSync(process.execPath, [AK, ...args], { cwd: ROOT, stdio: inherit ? "inherit" : "pipe", encoding: "utf8" });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/**
 * Run `ak play` on the terminal. stderr is kept (and shown once play ends) so a crash can go
 * into the report; `akPath` lets a test stand in a fake `ak`.
 */
export function runPlay(args, { akPath = AK } = {}) {
  const result = spawnSync(process.execPath, [akPath, "play", ...args], { cwd: ROOT, stdio: ["inherit", "inherit", "pipe"], encoding: "utf8" });
  const stderr = result.stderr ?? "";
  if (stderr) process.stderr.write(stderr);
  const status = result.status ?? (result.error ? 1 : 0);
  return { status, stderrTail: status === 0 ? "" : stderr.trimEnd().split("\n").slice(-20).join("\n") };
}

function git(args) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

function lastJson(text) {
  const line = text.trim().split("\n").at(-1) ?? "";
  try { return JSON.parse(line); } catch { return null; }
}

function build(scenario, seed, levelDir, createdAt, grade, character) {
  const result = ak(["create", ...createArgs(scenario, seed, createdAt, grade, character), "--out-dir", levelDir]);
  const parsed = lastJson(result.stdout);
  if (result.status !== 0 || parsed?.ok === false) {
    throw new Error(`ak create refused ${scenario.id} (seed ${seed}):\n${result.stderr || result.stdout}`);
  }
  return parsed;
}

/** Replay a recording on the level with no further keys; returns the final screen and status. */
function finalState(levelDir, recordingPath) {
  const result = ak(["play", "--dir", levelDir, "--replay", recordingPath, "--keys", "", "--json", "--no-color"]);
  return lastJson(result.stdout) ?? { screen: result.stdout || result.stderr };
}

/**
 * The character screen: build the scenario once as written to learn what the Allocator allots the
 * delver, then let the player configure theirs against that. Returns the `--delver` spec, or null
 * when they go back. The screen is the ui-ascii program; this script never imports it.
 */
function configureCharacter(scenario, seed, createdAt, grade, defaultDir) {
  const built = build(scenario, seed, defaultDir, createdAt, grade);
  const receipt = JSON.parse(readFileSync(join(defaultDir, "budget-receipt.json"), "utf8"));
  const pool = receipt.poolStatuses?.find((entry) => entry.id === "delver");
  const specPath = join(defaultDir, "character-spec.txt");
  const result = spawnSync(process.execPath, [
    CHARACTER_CLI, "--spec", playerDelverSpec(scenario, seed), "--budget", String(pool?.capTokens ?? built?.cost?.budgetTokens ?? 0), "--out", specPath,
  ], { cwd: ROOT, stdio: "inherit" });
  if (result.status !== 0 || !existsSync(specPath)) return null;
  return readFileSync(specPath, "utf8").trim();
}

function stamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
}

function parseArgs(argv) {
  const options = { playArgs: [] };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") { options.playArgs = argv.slice(i + 1); break; }
    if (arg === "--seed") options.seed = Number(argv[++i]);
    else if (arg === "--open") options.open = argv[++i];
    else if (arg === "--keys") options.keys = argv[++i];
    else if (arg === "--grade") options.grade = argv[++i];
    else if (arg === "--character") options.character = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else rest.push(arg);
  }
  options.scenario = rest[0];
  return options;
}

function listScenarios(catalog) {
  console.log("Playtest scenarios (bash scripts/game/playtest.sh <id> [--seed N] [--grade H..S] [--character]):\n");
  for (const scenario of catalog.scenarios) {
    console.log(`  ${scenario.id.padEnd(12)} ${scenario.title}`);
    if (scenario.shows) console.log(`  ${"".padEnd(12)} shows: ${scenario.shows}`);
  }
  console.log("\nAfter you quit (q) you are asked what you noticed; the report lands in artifacts/playtest/.");
  console.log("Re-open a report: bash scripts/game/playtest.sh --open <report.md>");
}

async function askNotes() {
  if (!process.stdin.isTTY) return [];
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log("\nWhat did you notice? One finding per line, with the turn number if you have it.");
  console.log("Press Enter on an empty line to finish (or straight away if nothing to report).");
  const notes = [];
  for (;;) {
    const line = (await rl.question(`  ${notes.length + 1}. `)).trim();
    if (!line) break;
    notes.push(line);
  }
  rl.close();
  return notes;
}

export function renderReport({ scenario, seed, grade, commit, branch, createdAt, playedAt, picks, final, notes, replayCode, cost, crash, character }) {
  const lines = [
    `# Playtest: ${scenario.title} (${scenario.id}, seed ${seed})`,
    "",
    `- Played: ${playedAt}`,
    `- Commit: ${commit} (${branch})`,
    `- Affinities: you ${picks.A} vs ${picks.B}; other pair ${picks.C}/${picks.D}`,
    ...(traitsInPlay(scenario, seed) ? [`- Traits: ${traitsInPlay(scenario, seed)}`] : []),
    ...(grade ? [`- Grade: ${grade}`] : []),
    ...(character ? [`- Character: \`${character}\``] : []),
    `- Level cost: ${cost ? `${cost.totalSpend} of ${cost.budgetTokens} tokens (${cost.status})` : "unknown"}`,
    `- Ended: turn ${final?.turns ?? "?"}, ${describeStatus(final?.status)}`,
    "",
    "## Findings",
    "",
    ...(notes.length ? notes.map((note, index) => `${index + 1}. ${note}`) : ["(none written)"]),
    "",
    ...(crash ? ["## Crash", "", `\`ak play\` exited with code ${crash.status}. The replay code below holds the commands recorded before it stopped.`, "", "```", crash.stderrTail || "(no stderr)", "```", ""] : []),
    "## Final screen",
    "",
    "```",
    (final?.screen ?? "").trimEnd(),
    "```",
    "",
    "## Reproduce",
    "",
    "```",
    `bash scripts/game/playtest.sh --open <this file>`,
    "```",
    "",
    `<!-- playtest ${JSON.stringify({ scenario: scenario.id, seed, ...(grade ? { grade } : {}), ...(character ? { character } : {}), commit, createdAt })} -->`,
    `<!-- replay ${replayCode} -->`,
    "",
  ];
  return lines.join("\n");
}

function describeStatus(status) {
  if (!status) return "status unknown";
  if (status.exited) return "reached the exit";
  if (status.defeated) return "defeated";
  return "still playing when quit";
}

export function parseReport(text) {
  const meta = text.match(/<!-- playtest (\{.*?\}) -->/);
  const replay = text.match(/<!-- replay ([A-Za-z0-9_-]*) -->/);
  if (!meta) throw new Error("this file has no playtest line; is it a playtest report?");
  return { ...JSON.parse(meta[1]), commands: replay?.[1] ? decodeReplay(replay[1]) : [] };
}

async function playScenario(catalog, options) {
  const scenario = catalog.scenarios.find((entry) => entry.id === options.scenario);
  if (!scenario) {
    console.error(`No scenario "${options.scenario}".\n`);
    listScenarios(catalog);
    process.exit(2);
  }
  const now = new Date();
  const seed = Number.isFinite(options.seed) ? options.seed : now.getTime() % 1000;
  const picks = affinitiesForSeed(seed);
  const outDir = join(ROOT, "artifacts/playtest", `${stamp(now)}-${scenario.id}-s${seed}`);
  const levelDir = join(outDir, "level");
  const recordingPath = join(outDir, "recording.json");
  mkdirSync(outDir, { recursive: true });

  const grade = options.grade;
  let character;
  if (options.character) {
    character = configureCharacter(scenario, seed, catalog.createdAt, grade, join(outDir, "default-level"));
    if (character === null) { console.log("Back to the shell; nothing was built."); return; }
  }
  const created = build(scenario, seed, levelDir, catalog.createdAt, grade, character);
  const traits = traitsInPlay(scenario, seed);
  if (character) console.log(`\n${scenario.title} (seed ${seed}): you play the character you configured; the wardens carry ${picks.B} and ${picks.D}.`);
  else console.log(traits
    ? `\n${scenario.title} (seed ${seed}): you carry ${traits}; the wardens carry ${picks.B} and ${picks.D}.`
    : `\n${scenario.title} (seed ${seed}): you are ${picks.A}, against ${picks.B}; other pair ${picks.C}/${picks.D}.`);
  if (created?.tactics?.length) console.log(`Tactics: ${created.tactics.map((entry) => entry.tactic).join(", ")}.`);
  console.log("Things to try:");
  for (const line of fillFocus(scenario, seed)) console.log(`  - ${line}`);
  console.log("Note the turn number (bottom of the HUD) when something looks wrong. Quit with q.");
  if (options.playArgs.includes("--web")) {
    console.log("\nBrowser play is not recorded: write the turn and what you saw in the report afterwards.");
  }
  if (process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    await rl.question("\nPress Enter to start. ");
    rl.close();
  }

  const record = options.playArgs.includes("--web") ? [] : ["--record", recordingPath];
  const played = runPlay(["--dir", levelDir, ...record, ...options.playArgs]);
  if (played.status !== 0) console.log(`\nak play stopped with exit code ${played.status}; the report will say so.`);

  const recorded = existsSync(recordingPath) ? JSON.parse(readFileSync(recordingPath, "utf8")) : null;
  const final = recorded ? finalState(levelDir, recordingPath) : null;
  const notes = await askNotes();
  const report = renderReport({
    scenario, seed, grade: created?.grade?.grade ?? grade, picks, final, notes,
    commit: git(["rev-parse", "--short", "HEAD"]),
    branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
    createdAt: catalog.createdAt,
    playedAt: now.toISOString(),
    replayCode: encodeReplay(recorded?.payload?.commands ?? []),
    cost: created?.cost,
    character,
    crash: played.status !== 0 ? played : undefined,
  });
  const reportPath = join(outDir, "report.md");
  writeFileSync(reportPath, report);
  console.log(`\nReport: ${relative(process.cwd(), reportPath)}`);
  if (process.platform === "darwin" && spawnSync("pbcopy", { input: report }).status === 0) {
    console.log("Copied to the clipboard: paste it into the playtest thread, or attach the file.");
  } else {
    console.log("Paste it into the playtest thread, or attach the file.");
  }
}

async function openReport(catalog, options) {
  const parsed = parseReport(readFileSync(resolve(options.open), "utf8"));
  const scenario = catalog.scenarios.find((entry) => entry.id === parsed.scenario);
  if (!scenario) throw new Error(`the report's scenario "${parsed.scenario}" is not in playtest-scenarios.json on this checkout`);
  const commit = git(["rev-parse", "--short", "HEAD"]);
  if (parsed.commit && !commit.startsWith(parsed.commit) && !parsed.commit.startsWith(commit)) {
    console.log(`Note: the report was played on ${parsed.commit}; this checkout is ${commit}. The level or the replay may differ.`);
    console.log(`For the exact game: git checkout ${parsed.commit}\n`);
  }
  const outDir = join(ROOT, "artifacts/playtest", `open-${parsed.scenario}-s${parsed.seed}`);
  const levelDir = join(outDir, "level");
  const recordingPath = join(outDir, "recording.json");
  mkdirSync(outDir, { recursive: true });
  build(scenario, parsed.seed, levelDir, parsed.createdAt ?? catalog.createdAt, parsed.grade, parsed.character);
  const capture = {
    schema: "agent-kernel/CapturedInputArtifact",
    schemaVersion: 1,
    meta: { producedBy: "play-session", id: `playtest_open_${parsed.scenario}_${parsed.seed}`, runId: `playtest-${parsed.scenario}-s${parsed.seed}`, createdAt: parsed.createdAt ?? catalog.createdAt },
    source: { adapter: "player", request: { source: { runDir: levelDir } } },
    contentType: "application/json",
    payload: { commands: parsed.commands },
  };
  writeFileSync(recordingPath, `${JSON.stringify(capture, null, 2)}\n`);
  console.log(`${scenario.title}, seed ${parsed.seed}: replaying ${parsed.commands.length} recorded turns.`);
  const keys = options.keys !== undefined ? ["--keys", options.keys, "--no-color"] : [];
  ak(["play", "--dir", levelDir, "--replay", recordingPath, ...keys, ...options.playArgs], { inherit: true });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const catalog = loadPlaytestScenarios();
  if (options.help || (!options.scenario && !options.open)) {
    listScenarios(catalog);
    return;
  }
  if (options.open) await openReport(catalog, options);
  else await playScenario(catalog, options);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
