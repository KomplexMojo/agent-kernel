/**
 * Simulation tests: build a level through `ak create`, run it headless through `ak run`,
 * and read what happened from the run's own artifacts.
 *
 * Two outputs per scenario:
 *   rules    properties that must hold on every level (a violation fails the gate)
 *   metrics  numbers that describe the run (reported and compared, never a failure)
 *
 * Levels always come from `ak create`, so the Allocator prices them and every persona
 * builds them as it would for a player; nothing here hand-writes a level.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const AK = join(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
export const SCENARIO_DIR = join(ROOT, "tests/simulations/scenarios");

/** Longest run of turns an actor may spend proposing only actions core refuses. */
export const REFUSED_STREAK_LIMIT = 5;
/** Longest run of turns a mobile or fighting actor may propose nothing at all. */
export const SILENT_STREAK_LIMIT = 20;
/** Accepted casts after which an actor must have spent some mana. */
export const FREE_CAST_LIMIT = 10;

export const RULES = Object.freeze({
  create_failed: "ak create refused the level",
  run_failed: "ak run failed",
  refused_streak: `an actor proposed only refused actions for ${REFUSED_STREAK_LIMIT}+ turns in a row`,
  silent_actor: `a mobile or fighting actor proposed nothing for ${SILENT_STREAK_LIMIT}+ turns in a row`,
  cast_without_cost: `an actor cast ${FREE_CAST_LIMIT}+ times without its mana ever dropping below max`,
  tick_one_defeat: "an actor was defeated on the first tick",
  adjacent_objects: "two hazards or resources were seated touching each other",
  authored_vitals: "an actor's vitals differ from the ones its spec authored",
  no_exit: "the scenario expects a delver to leave, and none did",
});

// Motivations that never move or fight on their own; an actor with only these may stay silent.
const HOLDING_MOTIVATIONS = new Set(["stationary", "defending", "reflexive", "user_controlled"]);

function runNode(args, { cwd = ROOT } = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [AK, ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolvePromise({ status, stdout, stderr }));
  });
}

export function loadScenarios(name) {
  return JSON.parse(readFileSync(join(SCENARIO_DIR, `${name}.json`), "utf8")).scenarios;
}

/** Build and run one scenario; returns its analysis (rules are checked separately). */
export async function runScenario(scenario, { keep = false } = {}) {
  const outRoot = mkdtempSync(join(tmpdir(), `ak-sim-${scenario.id}-`));
  const createDir = join(outRoot, "create");
  const runDir = join(outRoot, "run");
  const result = { id: scenario.id, outRoot };
  try {
    const create = await runNode([
      "create", "--run-id", `sim-${scenario.id}`, "--out-dir", createDir, "--created-at", "2026-01-01T00:00:00Z",
      ...(scenario.budget ? ["--budget-tokens", String(scenario.budget)] : []),
      ...scenario.args,
    ]);
    if (create.status !== 0) {
      result.createError = `${create.stderr}${create.stdout}`.trim().slice(0, 600);
      return result;
    }
    const run = await runNode([
      "run", "--sim-config", join(createDir, "sim-config.json"), "--initial-state", join(createDir, "initial-state.json"),
      "--ticks", String(scenario.ticks ?? 40), "--run-id", `sim-${scenario.id}-run`, "--out-dir", runDir,
    ]);
    if (run.status !== 0) {
      result.runError = `${run.stderr}${run.stdout}`.trim().slice(0, 600);
      return result;
    }
    const initialState = JSON.parse(readFileSync(join(createDir, "initial-state.json"), "utf8"));
    const frames = JSON.parse(readFileSync(join(runDir, "tick-frames.json"), "utf8"));
    return { ...result, ...analyzeRun({ initialState, frames }) };
  } finally {
    if (!keep) rmSync(outRoot, { recursive: true, force: true });
  }
}

const isObjectActor = (actor) => actor?.capabilities?.canMove === false && (actor.motivations ?? []).length === 0;

/** Per-actor timelines and run metrics, read from the initial state and the tick frames. */
export function analyzeRun({ initialState, frames }) {
  const actors = {};
  for (const actor of initialState.actors ?? []) {
    actors[actor.id] = {
      id: actor.id,
      object: isObjectActor(actor),
      motivations: actor.motivations ?? [],
      position: actor.position,
      vitals: actor.vitals,
      proposed: 0, accepted: 0, casts: 0, moves: 0,
      refusedStreak: 0, maxRefusedStreak: 0, silentStreak: 0, maxSilentStreak: 0,
      minVitals: {}, lifecycle: actor.lifecycle, exitedAt: null, defeatedAt: null,
    };
  }
  const proposedByTick = new Map();
  for (const frame of frames) {
    if (frame.phaseDetail === "decide") {
      const counts = proposedByTick.get(frame.tick) ?? {};
      for (const action of frame.personaActions ?? []) counts[action.actorId] = (counts[action.actorId] ?? 0) + 1;
      proposedByTick.set(frame.tick, counts);
    }
  }
  let ticks = 0;
  for (const frame of frames) {
    if (frame.phaseDetail !== "apply") continue;
    ticks = Math.max(ticks, frame.tick);
    const proposed = proposedByTick.get(frame.tick) ?? {};
    const accepted = {};
    for (const action of frame.acceptedActions ?? []) {
      accepted[action.actorId] = (accepted[action.actorId] ?? 0) + 1;
      const record = actors[action.actorId];
      if (!record) continue;
      if (action.kind === "cast_affinity") record.casts += 1;
      if (action.kind === "move") record.moves += 1;
    }
    const registry = frame.emittedSnapshot?.view?.registry?.actors ?? [];
    const lifecycleBefore = new Map(Object.values(actors).map((record) => [record.id, record.lifecycle]));
    for (const entry of registry) {
      const record = actors[entry.id];
      if (!record) continue;
      for (const [vital, value] of Object.entries(entry.vitals ?? {})) {
        const current = Number(value?.current);
        if (!Number.isFinite(current)) continue;
        if (record.minVitals[vital] === undefined || current < record.minVitals[vital]) record.minVitals[vital] = current;
      }
      if (entry.lifecycle === "exited" && record.exitedAt === null) record.exitedAt = frame.tick;
      if (entry.lifecycle === "defeated" && record.defeatedAt === null) record.defeatedAt = frame.tick;
      record.lifecycle = entry.lifecycle;
      record.final = { position: entry.position, vitals: entry.vitals };
    }
    for (const record of Object.values(actors)) {
      if (record.object || lifecycleBefore.get(record.id) !== "alive") continue;
      const p = proposed[record.id] ?? 0;
      const a = accepted[record.id] ?? 0;
      record.proposed += p;
      record.accepted += a;
      record.refusedStreak = p > 0 && a === 0 ? record.refusedStreak + 1 : 0;
      record.maxRefusedStreak = Math.max(record.maxRefusedStreak, record.refusedStreak);
      record.silentStreak = p === 0 ? record.silentStreak + 1 : 0;
      record.maxSilentStreak = Math.max(record.maxSilentStreak, record.silentStreak);
    }
  }
  return { ticks, actors, metrics: summarizeMetrics(actors, ticks) };
}

function summarizeMetrics(actors, ticks) {
  const movers = Object.values(actors).filter((record) => !record.object);
  const exits = movers.map((record) => record.exitedAt).filter((tick) => tick !== null);
  let healthLost = 0;
  for (const record of Object.values(actors)) {
    const health = record.vitals?.health;
    if (health && record.minVitals.health !== undefined) healthLost += Math.max(0, health.current - record.minVitals.health);
  }
  const proposed = movers.reduce((sum, record) => sum + record.proposed, 0);
  const accepted = movers.reduce((sum, record) => sum + record.accepted, 0);
  return {
    ticks,
    firstExit: exits.length ? Math.min(...exits) : null,
    exited: exits.length,
    defeated: Object.values(actors).filter((record) => record.defeatedAt !== null).length,
    healthLost: Math.round(healthLost * 100) / 100,
    casts: movers.reduce((sum, record) => sum + record.casts, 0),
    moves: movers.reduce((sum, record) => sum + record.moves, 0),
    acceptRate: proposed ? Math.round((accepted / proposed) * 1000) / 1000 : null,
  };
}

/** `vitals=health:30:2,...` (max:regen) or `health:10:30:2` (current:max:regen), keyed by vital. */
export function parseAuthoredVitals(spec) {
  const match = /(?:^|;)vitals=([^;]+)/.exec(spec);
  if (!match) return null;
  const vitals = {};
  for (const part of match[1].split(",")) {
    const [name, ...numbers] = part.split(":");
    const values = numbers.map(Number);
    if (values.length === 2) vitals[name] = { max: values[0], regen: values[1] };
    if (values.length === 3) vitals[name] = { current: values[0], max: values[1], regen: values[2] };
  }
  return vitals;
}

/** Authored vitals per actor-id prefix (`id=hero` makes hero-1, hero-2, ...). */
function authoredVitalsById(scenario) {
  const byPrefix = [];
  for (let index = 0; index < scenario.args.length - 1; index += 1) {
    if (scenario.args[index] !== "--delver" && scenario.args[index] !== "--warden") continue;
    const spec = scenario.args[index + 1];
    const id = /(?:^|;)id=([^;]+)/.exec(spec)?.[1];
    const vitals = parseAuthoredVitals(spec);
    if (id && vitals) byPrefix.push({ prefix: `${id}-`, vitals });
  }
  return byPrefix;
}

/** Every rule violation in one analysed scenario, as `{ rule, actor?, detail }`. */
export function checkRules(scenario, analysis) {
  if (analysis.createError) return [{ rule: "create_failed", detail: analysis.createError }];
  if (analysis.runError) return [{ rule: "run_failed", detail: analysis.runError }];
  const violations = [];
  const records = Object.values(analysis.actors);
  for (const record of records) {
    if (record.maxRefusedStreak >= REFUSED_STREAK_LIMIT) {
      violations.push({ rule: "refused_streak", actor: record.id, detail: `${record.maxRefusedStreak} turns` });
    }
    const mobile = record.motivations.some((kind) => !HOLDING_MOTIVATIONS.has(kind));
    if (!record.object && mobile && record.maxSilentStreak >= SILENT_STREAK_LIMIT) {
      violations.push({ rule: "silent_actor", actor: record.id, detail: `${record.maxSilentStreak} turns` });
    }
    const mana = record.vitals?.mana;
    if (record.casts >= FREE_CAST_LIMIT && mana && record.minVitals.mana >= mana.max) {
      violations.push({ rule: "cast_without_cost", actor: record.id, detail: `${record.casts} casts` });
    }
    if (record.defeatedAt !== null && record.defeatedAt <= 1) {
      violations.push({ rule: "tick_one_defeat", actor: record.id });
    }
  }
  const objects = records.filter((record) => record.object);
  for (let i = 0; i < objects.length; i += 1) {
    for (let j = i + 1; j < objects.length; j += 1) {
      const a = objects[i].position;
      const b = objects[j].position;
      if (a && b && Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) <= 1) {
        violations.push({ rule: "adjacent_objects", actor: objects[i].id, detail: `touches ${objects[j].id}` });
      }
    }
  }
  for (const { prefix, vitals } of authoredVitalsById(scenario)) {
    for (const record of records.filter((entry) => entry.id.startsWith(prefix))) {
      for (const [name, authored] of Object.entries(vitals)) {
        const built = record.vitals?.[name];
        const differs = !built || Object.entries(authored).some(([field, value]) => built[field] !== value);
        if (differs) {
          violations.push({ rule: "authored_vitals", actor: record.id,
            detail: `${name} authored ${JSON.stringify(authored)}, built ${JSON.stringify(built ?? null)}` });
        }
      }
    }
  }
  if (scenario.expect?.exit && !records.some((record) => record.exitedAt !== null)) {
    violations.push({ rule: "no_exit", detail: `no delver left within ${analysis.ticks} ticks` });
  }
  return violations;
}

/** Splits violations into known (listed on the scenario with an issue) and new, plus known ones that no longer occur. */
export function compareWithKnown(scenario, violations) {
  const known = scenario.knownIssues ?? [];
  const matches = (entry, violation) => entry.rule === violation.rule && (!entry.actor || entry.actor === violation.actor);
  return {
    unexpected: violations.filter((violation) => !known.some((entry) => matches(entry, violation))),
    fixed: known.filter((entry) => !violations.some((violation) => matches(entry, violation))),
  };
}

/** Run scenarios a few at a time; results come back in catalogue order. */
export async function runScenarios(scenarios, { concurrency = 4, keep = false } = {}) {
  const results = new Array(scenarios.length);
  let next = 0;
  const worker = async () => {
    while (next < scenarios.length) {
      const index = next;
      next += 1;
      results[index] = await runScenario(scenarios[index], { keep });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, scenarios.length) }, worker));
  return results;
}
