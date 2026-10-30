/**
 * play-session.js — a single-player, step-at-a-time driver an interactive UI uses.
 *
 * Every other driver in the repo runs to completion and hands back recorded
 * frames (`createPlaybackRuntime`); a UI then scrubs them. An interactive
 * surface needs the opposite: one player command, one tick, one fresh frame.
 * This module is that seam, so a UI (`packages/ui-ascii`) never has to reach
 * into `core-ts` itself — the charter keeps UI code on runtime helpers.
 *
 * Each `act(command)` is one `runtime.step({ actorCommands })`: the player's actor
 * does the command and every other actor takes its own Actor-persona turn in the
 * same tick. A rejected move still costs the turn (maintainer ruling, 2026-10-10).
 *
 * The level is a unified-actor level: terrain plus one actor list, where traps
 * are hazard actors and barriers are barrier actors. It is glue, not rules:
 *   - **What a command means is the Actor's** (`normalizeActorCommand`); the
 *     Actor turns it into the player's proposal.
 *   - **Legality is core's.** Rejections carry core's ValidationError name
 *     (`BlockedByWall`, `ActorCollision`, ...), never second-guessed.
 *   - **Leaving the level is core's** exit-dwell rule (two ends of tick on exit
 *     terrain), read back through the runtime; `atExit` is "standing on exit
 *     terrain and not yet gone".
 *   - **The board is the registry's terrain** drawn with the level's own render
 *     legend (`ASCII_TERRAIN_GLYPHS` by default), barriers as `B` and the player
 *     as `@`; `view().actors` and `view().hazards` carry everyone else.
 *   - **Which actors are traps is presentation**, the level's `presentation`
 *     category, read through the runtime; core never dispatches on it.
 *   - **HUD semantics are runtime render's** (`render/actor-hud-model.js`).
 *   - **Sight is core's** (`readActorRegistryVisibleCells`, read through the
 *     runtime). This session only REMEMBERS: a cell the player has seen stays
 *     explored until dark covers it out of sight (core's `readDarkCells`), which
 *     forgets it. view() then applies fog: a never-seen cell is the fog
 *     glyph, an explored cell out of sight shows its base tile (no actors), and
 *     `sight` tells the UI which cells to dim.
 *
 * The view is built by `buildPlayView`, a pure function of one registry snapshot,
 * so `runner/run-viewer.js` draws a recorded run's ticks in the same shape.
 *
 * **Party control (Phase 2).** The party is every actor authored `user_controlled`
 * (Darren, 2026-10-13), plus the seated actor when a caller names another. One is
 * active: `act` commands it (or the party member `actorId` names), `switchTo` moves
 * the seat for free (no tick), and fog follows the active actor while each party
 * member keeps its own explored memory. A companion or warden is never seated by a
 * switch (`not_playable`). Every actor in a view carries a short stable label (`D1`,
 * `W2`, `H3`: role letter, then its place in id order) a caller may use in place of
 * an id, for a switch, an `actorId` or a cast's `targetId`.
 *
 * **Orders (Phase 2b).** `order(actor, strategy)` gives a party member or a companion
 * (a `friendly` actor on the seated actor's side, #311) a new strategy: goals and tactics the Actor
 * follows on that actor's own turns, as deep as its thinking motivation reaches. Giving
 * it is the seated actor's turn and taking it is the ordered actor's (decision 8), so
 * one tick runs with both waiting. A strategy's targets may be labels. `strategies()`
 * and `view().orders` read each actor's progress back from the Actor.
 *
 * **Replay (#204).** Every command that runs a tick is logged as
 * `{ tick, actorId, command }`; `captureInput({ meta })` returns the log as a
 * CapturedInputArtifact (`source.adapter: "player"`), and `replayPlaySession`
 * re-runs it on the same level. The simulation is deterministic, so a replay
 * reaches the same state. Writing the artifact to disk is the caller's job.
 */
import { AFFINITY_TABLE } from "../../../core-ts/src/state/affinity-table.ts";
import { ACTOR_COMMAND_KINDS, normalizeActorCommand, normalizeActorStrategy } from "../personas/actor/persona.js";
import { createConfiguratorPersona } from "../personas/configurator/persona.js";
import { createAllocatorPersona } from "../personas/allocator/persona.js";
import { UNUSED_CLOCK } from "../personas/_shared/require-clock.js";
import { EIGHT_WAY_DELTAS } from "../personas/_shared/movement-directions.js";
import { buildActorHudModel } from "../render/actor-hud-model.js";
import { battleLogLine } from "../render/battle-log-lines.js";
import { ASCII_FOG_GLYPH, ASCII_TERRAIN_GLYPHS, asciiCastPathGlyph } from "../render/visualization-snapshot.js";
import { wallGlyphAt, wallGlyphChars } from "../render/wall-glyphs.js";
import { actorGlyphs } from "../render/actor-glyphs.js";
import { createPlaybackRuntime, createRuntimeCore } from "./core-facade.js";
import { CAPTURED_INPUT_SCHEMA } from "../contracts/artifacts.ts";
import { equippedActorAffinityKeys, exhaustedActorAffinityKeys, MAX_AFFINITY_SLOTS } from "../../../core-ts/src/state/actor-inventory.ts";
import { unpayableActorAffinities } from "../../../core-ts/src/rules/actor-upkeep.ts";
import { actorCastableAffinities } from "../../../core-ts/src/rules/actor-cast.ts";
import { actorHoldingsOpen } from "../../../core-ts/src/state/actor-holdings.ts";
import { revealedValue } from "../../../core-ts/src/rules/actor-observation.ts";

export const PLAY_COMMAND_KINDS = ACTOR_COMMAND_KINDS;

/** Per-cell sight in `view().sight`: seen now, seen before, never seen. */
export const PLAY_SIGHT = Object.freeze({ VISIBLE: "v", REMEMBERED: "r", UNKNOWN: "u" });

// Whether a loaded level's actors meet the viability floor is the Configurator's question.
const reportActorViabilityFloor = createConfiguratorPersona({ clock: UNUSED_CLOCK })
  .authorCandidates.reportActorViabilityFloor;

export const PLAY_DIRECTIONS = Object.freeze(EIGHT_WAY_DELTAS.map((delta) => delta.direction));
/** Each direction's step, for a UI moving an aim cursor over the board (#413). */
export const PLAY_DIRECTION_STEPS = Object.freeze(Object.fromEntries(EIGHT_WAY_DELTAS.map(({ direction, dx, dy }) =>
  [direction, Object.freeze({ dx, dy })])));

/** An absent command is a wait; everything else is the Actor's vocabulary. */
export function normalizePlayCommand(command) {
  return normalizeActorCommand(command ?? { kind: "wait" });
}

function isGameplayAction(action) {
  return Boolean(action) && action.kind !== "emit_log" && action.kind !== "emit_telemetry";
}

function toPlayAction(action) {
  return { actorId: action.actorId, tick: action.tick, kind: action.kind, params: { ...action.params } };
}

// runtime-fsm prefixes core's ValidationError name ("actor_action_rejected_by_core:BlockedByWall").
function toPlayRejection({ action, reason }) {
  const text = String(reason || "");
  return { ...toPlayAction(action), reason: text.slice(text.lastIndexOf(":") + 1) || text };
}

const HAZARD_CATEGORY = "hazard";
const BARRIER_CATEGORY = "barrier";
const RESOURCE_CATEGORY = "resource";
export const PLAYER_MOTIVATION = "user_controlled";

// The level's presentation names what each authored actor is; a barrier raised in play
// (#413) is not in it, and core marks it by its owner.
function categoryOf(actor, presentation) {
  return presentation[actor.id]?.category ?? (actor.raisedBy !== undefined ? BARRIER_CATEGORY : null);
}
/** The motivation that makes an actor on your side a companion you may order (Darren, #311). */
export const COMPANION_MOTIVATION = "friendly";

/**
 * @param {object} args
 * @param {object} args.simConfig      agent-kernel/SimConfigArtifact (unified terrain)
 * @param {object} args.initialState   agent-kernel/InitialStateArtifact (unified actors)
 * @param {string} [args.playerActorId] any configured actor; defaults to the first (by id)
 *                                     `user_controlled` actor, else the first delver, else the first actor
 * @param {object} [args.core]         a core to drive; a fresh one by default
 * @param {Function} [args.clock]      injected clock for the runtime
 * @param {object}   [args.personas]   persona registry override (ablation tests); the real one by default
 * @param {boolean}  [args.fog]        apply fog of war to view(); off by default so a
 *                                     caller opts in when it draws `sight`
 * @param {string}   [args.glyphSet]   "unicode" (default) or "ascii": the wall glyph set (#574)
 */
export async function createPlaySession({
  simConfig,
  initialState,
  playerActorId,
  core = createRuntimeCore(),
  clock,
  adapters = {},
  personas,
  fog = false,
  costing = null,
  glyphSet = "unicode",
} = {}) {
  if (!simConfig || !initialState) {
    throw new Error("createPlaySession: simConfig and initialState are required");
  }
  const sourceActors = (Array.isArray(initialState.actors) ? initialState.actors : [])
    .filter((actor) => typeof actor?.id === "string" && actor.id);
  const configuredIds = sourceActors.map((actor) => actor.id);
  const playerId = playerActorId ?? defaultPlayerActorId(initialState);
  if (playerId !== undefined && !configuredIds.includes(playerId)) {
    throw new Error(`createPlaySession: playerActorId "${playerId}" is not an actor in this level`);
  }

  const runtime = createPlaybackRuntime({ core, adapters, clock, ...(personas ? { personas } : {}) });
  try {
    await runtime.init({ seed: simConfig.seed ?? 0, simConfig, initialState });
  } catch (error) {
    throw new Error(`createPlaySession: level did not load (${error?.message || "unknown"})`);
  }
  if (!runtime.getActorSnapshot()) {
    throw new Error("createPlaySession: level did not load (no unified actors)");
  }
  const presentation = runtime.getActorPresentation() || {};
  // A hand-written level is played as written; actors below the floor are only reported.
  const viabilityReport = Object.freeze(reportActorViabilityFloor(initialState).map((finding) => Object.freeze(finding)));
  // A level the Allocator never priced is played too, and reported (#279).
  const allocator = createAllocatorPersona({ clock: UNUSED_CLOCK });
  const pricingReport = Object.freeze(allocator.reportLevelPricing(simConfig).map((finding) => Object.freeze(finding)));
  // The cast prices core charges this level, as the Allocator reads them, so each slot can show its cast's mana.
  const castManaBase = allocator.castPricesFromLegacyTiers(simConfig.actionCosts ?? null)?.castManaBase;
  const castPrices = castManaBase && typeof castManaBase === "object" ? { castManaBase } : undefined;
  const legend = playLegend(simConfig);
  const labels = playActorLabels(sourceActors, presentation);
  // The party: every playable actor, and the seated one even when it is not (a caller's choice).
  const partyIds = playableActorIds(initialState);
  if (playerId !== undefined && !partyIds.includes(playerId)) partyIds.unshift(playerId);
  // A party member's escorts (its minions) report to it: their events are its to read.
  const escortsOf = (pid) => Object.entries(initialState?.escorts ?? {})
    .filter(([, escort]) => escort?.target === pid).map(([id]) => id);
  let activeId = playerId;

  // Explored memory, per party member: a cell stays explored once that actor has seen it.
  const explored = new Map();
  // Every command that ran a tick, in order (#204).
  const commandLog = [];

  /** An actor id, or a label standing for one; undefined when it names nobody. */
  function resolveActorRef(ref) {
    if (typeof ref !== "string" || !ref) return undefined;
    if (configuredIds.includes(ref)) return ref;
    const upper = ref.toUpperCase();
    for (const [id, label] of labels) if (label === upper) return id;
    return undefined;
  }

  function readVisible(actorId = activeId) {
    const grid = runtime.readVisibleCells(actorId);
    return Array.isArray(grid) && grid.length > 0 ? grid : null;
  }

  // Dark invalidates memory (#203): a remembered cell that dark covers and the
  // actor cannot see right now is forgotten, back to fog until seen again.
  function rememberVisible(actorId) {
    if (runtime.hasActorExited(actorId)) return;
    const visible = readVisible(actorId);
    if (!visible) return;
    if (!explored.has(actorId)) explored.set(actorId, visible.map((row) => row.map(() => 0)));
    const memory = explored.get(actorId);
    const dark = runtime.readDarkCells();
    visible.forEach((row, y) => row.forEach((cell, x) => {
      if (cell) memory[y][x] = 1;
      else if (dark[y]?.[x]) memory[y][x] = 0;
    }));
  }

  const rememberParty = () => partyIds.forEach(rememberVisible);
  rememberParty();

  // Who left the level during the last command (#428): `{ id, label?, role, how }`, `how`
  // being "exited" or "defeated" (core's lifecycle verdict). Watched are the actors on the
  // seated actor's side, wherever they are, and any other the seat could see before the tick,
  // so the fog leaks nothing.
  let departures = [];
  // #490: where a defeat happened stays marked for a few ticks: `{ x, y, role, age }`.
  const DEFEAT_MARK_TICKS = 3;
  let defeatMarks = [];
  function watchedIds() {
    const actors = readSnapshot().actors;
    const seat = actors.find((actor) => actor.id === activeId);
    const visible = fog && !runtime.hasActorExited(activeId) ? readVisible() : null;
    return actors.filter((actor) => actor.lifecycle === "alive" && actor.id !== activeId
      && ((seat && actor.alignment === seat.alignment) || !visible || visible[actor.position.y]?.[actor.position.x]))
      .map((actor) => actor.id);
  }

  // One tick of the world, then the party's memory and the departures it caused.
  async function stepWorld(args) {
    const watched = watchedIds();
    const stocked = readSnapshot().actors.filter((actor) => watched.includes(actor.id) && categoryOf(actor, presentation) === RESOURCE_CATEGORY
      && hasLoot(actor)).map((actor) => actor.id);
    const before = readSnapshot().actors.map((actor) => [actor.id, actor.lifecycle, runtime.hasActorExited(actor.id)]);
    await runtime.step(args);
    recordEvents(before);
    rememberParty();
    recordBattleLog();
    const actors = readSnapshot().actors;
    defeatMarks = defeatMarks.map((mark) => ({ ...mark, age: mark.age + 1 })).filter((mark) => mark.age < DEFEAT_MARK_TICKS);
    for (const id of watched) {
      const actor = actors.find((entry) => entry.id === id);
      if (!actor || actor.lifecycle === "alive") continue;
      const role = categoryOf(actor, presentation) ?? null;
      const defeat = actor.lifecycle === "defeated" ? { position: { ...actor.position }, by: defeatedBy(actor, actors) } : {};
      departures.push({ id, ...(labels.has(id) ? { label: labels.get(id) } : {}), role, how: actor.lifecycle, ...defeat });
      if (defeat.position) defeatMarks.push({ ...defeat.position, role, age: 0 });
    }
    // A resource emptied this tick leaves a spent mark where it stood (Darren, 2026-10-30).
    for (const id of stocked) {
      const actor = actors.find((entry) => entry.id === id);
      if (actor?.lifecycle === "alive" && !hasLoot(actor)) defeatMarks.push({ ...actor.position, role: RESOURCE_CATEGORY, spent: true, age: 0 });
    }
  }

  // #500: every cast, take, defeat and exit of every actor, whoever could see it. It feeds
  // `debugView()` only; no player-facing view reads it.
  const eventLog = [];
  function recordEvents(before) {
    const tick = currentTick();
    const apply = runtime.getTickFrames().filter((frame) => frame?.phaseDetail === "apply").at(-1) || {};
    for (const cast of rawCasts()) {
      eventLog.push({ tick, event: "cast", sourceId: cast.sourceId, targetId: cast.targetId ?? null, kind: cast.kind,
        expression: cast.expression, changes: (cast.changes || []).map((change) => ({ ...change })) });
    }
    for (const action of apply.acceptedActions || []) {
      if (action?.kind === "take") eventLog.push({ tick, event: "take", actorId: action.actorId, params: { ...action.params } });
    }
    const actors = readSnapshot().actors;
    for (const [id, lifecycle, exited] of before) {
      const actor = actors.find((entry) => entry.id === id);
      if (!actor) continue;
      if (lifecycle === "alive" && actor.lifecycle === "defeated") eventLog.push({ tick, event: "defeat", actorId: id, by: defeatedBy(actor, actors) });
      if (!exited && runtime.hasActorExited(id)) eventLog.push({ tick, event: "exit", actorId: id });
    }
    if (eventLog.length > 1000) eventLog.splice(0, eventLog.length - 1000);
  }

  // #554: the Annotator's battle-log entries, each with the party members who may read it. The
  // session only keeps and filters what the Annotator derived (it words and derives nothing).
  const battleLog = [];
  let battleLogTick = -1;
  function recordBattleLog() {
    const emit = runtime.getTickFrames().filter((frame) => frame?.phaseDetail === "emit").at(-1);
    const entries = [emit?.telemetry].flat().filter(Boolean).flatMap((telemetry) => telemetry.battleLog ?? [])
      .filter((entry, index, all) => entry.tick > battleLogTick && all.findIndex((other) => other.meta.id === entry.meta.id) === index);
    if (entries.length === 0) return;
    battleLogTick = Math.max(...entries.map((entry) => entry.tick));
    const actors = readSnapshot().actors;
    const vitalChanges = runtime.getTickFrames().filter((frame) => frame?.phaseDetail === "apply").at(-1)?.emittedSnapshot?.view?.turn?.vitalChanges ?? [];
    for (const entry of entries) {
      const involved = [entry.sourceId, entry.targetId].filter(Boolean);
      const cells = involved.map((id) => actors.find((actor) => actor.id === id)?.position).filter(Boolean);
      // Fog hides what no one on the party saw or was part of (#497).
      const readers = partyIds.filter((pid) => involved.includes(pid) || !fog
        || escortsOf(pid).some((id) => involved.includes(id))
        || cells.some((cell) => readVisible(pid)?.[cell.y]?.[cell.x]));
      // #573: a party member's (or its minion's) field or cast that hurts one of its own side.
      const side = new Set([...partyIds, ...partyIds.flatMap(escortsOf)]);
      const ally = entry.sourceId !== entry.targetId && side.has(entry.sourceId) && side.has(entry.targetId);
      // #582: the amount and the net after regen, for a target whose vitals the party may read.
      const row = entry.event === "field" ? AFFINITY_TABLE.find((candidate) => candidate.kind === entry.kind) : null;
      const change = row && (side.has(entry.targetId))
        ? vitalChanges.find((candidate) => candidate.actorId === entry.targetId && candidate.vital === row.primaryVital) : null;
      battleLog.push({ entry, readers, ally, ...(change ? { effect: { vital: change.vital, hit: change.hit, regen: change.regen } } : {}) });
    }
    if (battleLog.length > 500) battleLog.splice(0, battleLog.length - 500);
  }

  /** The last `limit` battle-log lines the seat may read, oldest first: `{ tick, event, text }`. */
  function battleLogView(limit = 30) {
    return battleLog.filter(({ readers }) => readers.includes(activeId)).slice(-limit)
      .map(({ entry, ally, effect }) => ({ tick: entry.tick, event: entry.event, ...(ally ? { ally: true, targetId: entry.targetId } : {}),
        ...(effect ? { detailed: true } : {}),
        text: battleLogLine(entry, { seatId: activeId, labelOf: (id) => labels.get(id) ?? null, effect }) }));
  }

  // #479: a mobile actor the seat has seen stays known at its last position until the seat
  // sees that cell empty (it left, or hid in dark), or it is gone. Per seat; fog only.
  const lastSeen = new Map();
  function lastSeenView(actors, snapshot, visible) {
    if (!visible) return [];
    const memory = lastSeen.get(activeId) ?? new Map();
    lastSeen.set(activeId, memory);
    for (const actor of actors) memory.set(actor.id, actor);
    const inView = new Set(actors.map((actor) => actor.id));
    const out = [];
    for (const [id, actor] of [...memory]) {
      if (inView.has(id)) continue;
      const live = snapshot.actors.find((entry) => entry.id === id);
      const { x, y } = actor.position;
      if (!live || live.lifecycle !== "alive" || runtime.hasActorExited(id) || visible[y]?.[x]) memory.delete(id);
      else out.push({ ...actor, lastSeen: true });
    }
    return out;
  }

  // Who or what defeated it: the last cast of the tick that landed on it, else the field it lay in.
  function defeatedBy(actor, actors) {
    const cast = rawCasts().filter((entry) => entry.targetId === actor.id && entry.sourceId !== actor.id).at(-1);
    if (cast) return { id: cast.sourceId, ...(labels.has(cast.sourceId) ? { label: labels.get(cast.sourceId) } : {}), kind: cast.kind, expression: cast.expression };
    const field = typeof runtime.readFieldCells === "function" ? runtime.readFieldCells() : null;
    const sources = (field?.[actor.position.y]?.[actor.position.x] || []).flatMap((entry) => entry.sources || []).filter((id) => id !== actor.id);
    return sources.length ? { id: sources[0], ...(labels.has(sources[0]) ? { label: labels.get(sources[0]) } : {}), field: true } : null;
  }

  function readSnapshot() {
    return runtime.getActorSnapshot();
  }

  function currentTick() {
    return runtime.readObservation()?.tick ?? 0;
  }

  function statusOf(actorId) {
    return playStatus({ snapshot: readSnapshot(), playerId: actorId, exited: runtime.hasActorExited(actorId), tick: currentTick() });
  }

  function status() {
    return statusOf(activeId);
  }

  /** Seat another party member. Free: no tick runs. */
  function switchTo(ref) {
    const actorId = resolveActorRef(ref);
    if (actorId === undefined) return { ok: false, reason: "unknown_actor", actorId: ref };
    if (!partyIds.includes(actorId)) return { ok: false, reason: "not_playable", actorId };
    activeId = actorId;
    return { ok: true, actorId, status: status() };
  }

  // Strategy progress, per actor, as the Actor keeps it (its context, read off the last frame).
  function strategies() {
    const frame = runtime.getTickFrames().at(-1);
    return structuredClone(frame?.personaViews?.actor?.context?.strategies ?? {});
  }

  // Every actor id a strategy names may be given as a label.
  function withStrategyRefsResolved(strategy) {
    if (!strategy || typeof strategy !== "object") return strategy;
    const ref = (value) => resolveActorRef(value) ?? value;
    const resolved = structuredClone(strategy);
    for (const goal of Array.isArray(resolved.goals) ? resolved.goals : []) {
      if (goal && typeof goal.target === "string") goal.target = ref(goal.target);
    }
    for (const tactic of Array.isArray(resolved.tactics) ? resolved.tactics : []) {
      if (typeof tactic?.when?.defeated === "string") tactic.when.defeated = ref(tactic.when.defeated);
      if (typeof tactic?.do?.params?.targetId === "string") tactic.do.params.targetId = ref(tactic.do.params.targetId);
    }
    return resolved;
  }

  // Who may be given orders: the party, and every companion: an actor on the seated
  // actor's side that is `friendly` (#311). Same side alone does not make a companion.
  function orderable(actorId) {
    if (partyIds.includes(actorId)) return true;
    const actors = readSnapshot().actors;
    const actor = actors.find((entry) => entry.id === actorId);
    const alignment = actors.find((entry) => entry.id === activeId)?.alignment;
    return actor?.alignment !== undefined && actor.alignment === alignment
      && Boolean(actor.motivations?.includes?.(COMPANION_MOTIVATION));
  }

  // Everyone `order` would accept right now, other than the seated actor, in id order (#272).
  // Your own side is known to you in or out of sight, as the party is.
  function orderableView(snapshot) {
    return snapshot.actors.filter((actor) => actor.id !== activeId && actor.lifecycle === "alive" && orderable(actor.id))
      .map((actor) => actor.id).sort(compareIds)
      .map((id) => ({ id, label: labels.get(id) ?? null }));
  }

  /** Give `ref` a new strategy. Costs a turn: the seated actor gives it, the ordered actor takes it. */
  async function order(ref, strategy) {
    const actorId = resolveActorRef(ref);
    const refuse = (reason, extra = {}) => ({ ok: false, reason, actorId: actorId ?? ref, tick: currentTick(), status: status(), ...extra });
    if (actorId === undefined) return refuse("unknown_actor");
    if (!orderable(actorId)) return refuse("not_yours");
    let normalized;
    try {
      normalized = normalizeActorStrategy(withStrategyRefsResolved(strategy));
    } catch (error) {
      return refuse("invalid_strategy", { error: error.message });
    }
    const target = statusOf(actorId);
    if (target.exited || target.defeated) return refuse(target.exited ? "exited" : "defeated");
    const seat = statusOf(activeId);
    const actorCommands = { [actorId]: { kind: "wait" } };
    if (!seat.exited && !seat.defeated) actorCommands[activeId] = { kind: "wait" };
    departures = [];
    await stepWorld({ actorCommands, actorStrategies: { [actorId]: normalized } });
    commandLog.push({ tick: currentTick(), actorId, seat: activeId, order: structuredClone(normalized) });
    return { ok: true, actorId, tick: currentTick(), strategy: normalized, status: status() };
  }

  // Whether any hostile is in sight of a party member still in the level.
  function hostileInSight() {
    const actors = readSnapshot().actors;
    return partyIds.some((id) => {
      const member = actors.find((actor) => actor.id === id);
      if (!member || member.lifecycle !== "alive") return false;
      const visible = readVisible(id);
      return actors.some((other) => other.lifecycle === "alive" && other.alignment !== member.alignment
        && visible?.[other.position.y]?.[other.position.x]);
    });
  }

  const ADVANCE_UNTIL = Object.freeze(["orders_done", "contact"]);
  const SETTLED = new Set(["done", "stalled", "ignored"]);

  /**
   * Let the world run (Phase 2b): up to `ticks` ticks in which the seated actor follows
   * its own strategy if it has one and otherwise waits. Stops early at `until`:
   * "orders_done" when every actor with a strategy is done, stalled or ignoring it;
   * "contact" when a hostile comes into a party member's sight. Each tick is logged.
   */
  async function advance({ ticks = 1, until } = {}) {
    if (!Number.isInteger(ticks) || ticks < 1) throw new Error("advance: ticks must be a positive integer");
    if (until !== undefined && !ADVANCE_UNTIL.includes(until)) {
      throw new Error(`advance: until must be one of ${ADVANCE_UNTIL.join(", ")}`);
    }
    const reached = () => (until === "orders_done" && Object.values(strategies()).every((entry) => SETTLED.has(entry.status)))
      || (until === "contact" && hostileInSight());
    let ran = 0;
    let stoppedBy = "ticks";
    departures = [];
    while (ran < ticks) {
      const seat = statusOf(activeId);
      if (seat.exited || seat.defeated) {
        stoppedBy = seat.exited ? "exited" : "defeated";
        break;
      }
      if (until && reached()) {
        stoppedBy = until;
        break;
      }
      const auto = Boolean(strategies()[activeId] || initialState.strategies?.[activeId]);
      await stepWorld(auto ? {} : { actorCommands: { [activeId]: { kind: "wait" } } });
      commandLog.push(auto ? { tick: currentTick(), actorId: activeId, auto: true }
        : { tick: currentTick(), actorId: activeId, command: { kind: "wait" } });
      ran += 1;
    }
    if (ran === ticks && until && reached()) stoppedBy = until;
    return { ticks: ran, stoppedBy, tick: currentTick(), status: status() };
  }

  /** Replay one logged tick the seated actor spent on its own strategy. */
  async function autoTick(actorId) {
    departures = [];
    await stepWorld({});
    commandLog.push({ tick: currentTick(), actorId, auto: true });
    return { tick: currentTick() };
  }

  // What each actor under orders is doing, for a UI or a caller: one line per actor.
  function ordersView() {
    return Object.entries(strategies()).map(([id, entry]) => {
      const strategy = entry.order ?? initialState.strategies?.[id];
      const goal = strategy?.goals?.[entry.goal];
      return {
        id,
        label: labels.get(id) ?? null,
        status: entry.status,
        goal: entry.goal,
        goals: strategy?.goals?.length ?? 0,
        ...(goal ? { doing: goal } : {}),
        ...(Number.isInteger(entry.tactic) ? { tactic: entry.tactic } : {}),
        ...(entry.reason ? { reason: entry.reason } : {}),
        ...(entry.ignored ? { ignored: entry.ignored } : {}),
      };
    }).sort((left, right) => compareIds(left.id, right.id));
  }

  // A cast's target may be a label; what the command means stays the Actor's.
  function withTargetResolved(command) {
    const targetId = command.params?.targetId;
    const resolved = resolveActorRef(targetId);
    if (resolved === undefined || resolved === targetId) return command;
    return { ...command, params: { ...command.params, targetId: resolved } };
  }

  // #497 (Darren, 2026-10-26): a one-turn look at one target. It runs a waiting tick for the
  // seated actor, then records what the seat can read of the target: its vitals, affinities
  // and motivations, capped by the reveal level there (at least 1, so a look always shows
  // the basics). The reading is the seat's memory of that moment, never live state.
  const inspections = new Map();
  async function inspect(command, actorRef) {
    const actorId = actorRef === undefined ? activeId : resolveActorRef(actorRef);
    const targetId = resolveActorRef(command.params?.targetId);
    const refuse = (reason) => ({ tick: currentTick(), accepted: [], status: status(),
      rejected: [{ actorId: actorId ?? actorRef, tick: currentTick() + 1, kind: "inspect", params: { targetId: command.params?.targetId }, reason }] });
    if (actorId === undefined) return refuse("unknown_actor");
    if (!partyIds.includes(actorId)) return refuse("not_playable");
    const before = statusOf(actorId);
    if (before.exited || before.defeated) return refuse(before.exited ? "exited" : "defeated");
    const actors = readSnapshot().actors;
    const target = actors.find((actor) => actor.id === targetId && actor.lifecycle === "alive" && actor.id !== actorId);
    if (!target) return refuse("InvalidTarget");
    const visible = fog ? readVisible() : null;
    if (visible && !visible[target.position.y]?.[target.position.x]) return refuse("TargetNotInSight");
    departures = [];
    const wait = { kind: "wait" };
    await stepWorld({ actorCommands: { [actorId]: wait } });
    commandLog.push({ tick: currentTick(), actorId, command: wait });
    const after = readSnapshot().actors.find((actor) => actor.id === targetId);
    if (after && after.lifecycle === "alive") {
      remember(actorId, after, readingOf(after, actorId, fog));
    }
    return { tick: currentTick(), rejected: [], status: status(),
      accepted: [{ actorId, tick: currentTick(), kind: "inspect", params: { targetId } }] };
  }

  function remember(actorId, target, reading) {
    if (!inspections.has(actorId)) inspections.set(actorId, new Map());
    inspections.get(actorId).set(target.id, { tick: currentTick(), reading });
  }

  // What the seat can read of an actor right now, capped by the reveal level there (at least 1).
  function readingOf(actor, actorId, fogOn) {
    const levels = fogOn && typeof runtime.readRevealLevels === "function" ? runtime.readRevealLevels(actorId) : null;
    const level = levels && !partyIds.includes(actor.id) ? Math.max(1, levels[actor.id] ?? 0) : undefined;
    return toViewActor(actor, presentation, labels, level, typeof runtime.readAffinityUpkeepTable === "function" ? runtime.readAffinityUpkeepTable() : []);
  }

  // #519: an actor the seat watches (it pays mana a turn, in core) reads live while in sight and
  // falls back to its last reading, with that age, while out of sight. Other readings are inspections.
  function inspectionsView(snapshot, visible) {
    const kept = inspections.get(activeId) ?? new Map();
    const watching = snapshot.actors.find((actor) => actor.id === activeId)?.watching ?? [];
    const rows = [];
    for (const target of snapshot.actors) {
      if (target.lifecycle !== "alive") continue;
      const watched = watching.includes(target.id);
      const inSight = !visible || visible[target.position.y]?.[target.position.x];
      if (watched && inSight) {
        const reading = readingOf(target, activeId, Boolean(visible));
        remember(activeId, target, reading);
        rows.push({ ...structuredClone(reading), inspectedAt: currentTick(), age: 0, watched: true });
        continue;
      }
      const entry = kept.get(target.id);
      if (!entry) continue;
      rows.push({ ...structuredClone(entry.reading), inspectedAt: entry.tick, age: currentTick() - entry.tick, ...(watched ? { watched: true } : {}) });
    }
    return rows.sort((left, right) => compareIds(left.id, right.id));
  }

  async function act(command, { actorId: actorRef } = {}) {
    if (command?.kind === "inspect") return inspect(command, actorRef);
    if (command?.kind === "watch") {
      const watcher = actorRef === undefined ? activeId : resolveActorRef(actorRef);
      const targetId = resolveActorRef(command.params?.targetId);
      const actors = readSnapshot().actors;
      const target = actors.find((actor) => actor.id === targetId && actor.lifecycle === "alive" && actor.id !== watcher);
      const refuseWatch = (reason) => ({ tick: currentTick(), accepted: [], status: status(),
        rejected: [{ actorId: watcher ?? actorRef, tick: currentTick() + 1, kind: "watch", params: { targetId: command.params?.targetId }, reason }] });
      if (watcher !== undefined && partyIds.includes(watcher)) {
        const watching = actors.find((actor) => actor.id === watcher)?.watching ?? [];
        // Ending a watch needs no sight or live target; beginning one needs both.
        if (!watching.includes(targetId)) {
          if (!target) return refuseWatch("InvalidTarget");
          const visible = fog ? readVisible(watcher) : null;
          if (visible && !visible[target.position.y]?.[target.position.x]) return refuseWatch("TargetNotInSight");
        }
      }
    }
    const normalized = withTargetResolved(normalizePlayCommand(command));
    const actorId = actorRef === undefined ? activeId : resolveActorRef(actorRef);
    const refuse = (reason, who = actorId ?? actorRef) => {
      const action = { actorId: who, tick: currentTick() + 1, kind: normalized.kind, params: { ...normalized.params } };
      return { tick: currentTick(), accepted: [], rejected: [{ ...action, reason }], status: status() };
    };
    if (actorId === undefined) return refuse("unknown_actor");
    if (!partyIds.includes(actorId)) return refuse("not_playable");
    // That actor's game is over once it has left the level or been defeated: no more ticks for it.
    const before = statusOf(actorId);
    if (before.exited || before.defeated) return refuse(before.exited ? "exited" : "defeated");
    departures = [];
    await stepWorld({ actorCommands: { [actorId]: normalized } });
    commandLog.push({ tick: currentTick(), actorId, command: structuredClone(normalized) });
    const applyFrame = runtime.getTickFrames().filter((frame) => frame?.phaseDetail === "apply").at(-1) || {};
    const accepted = (applyFrame.acceptedActions || [])
      .filter((action) => action?.actorId === actorId && isGameplayAction(action))
      .map(toPlayAction);
    const rejected = (applyFrame.preCoreRejections || [])
      .filter((entry) => entry?.action?.actorId === actorId && isGameplayAction(entry.action))
      .map(toPlayRejection);
    return { tick: currentTick(), accepted, rejected, status: status() };
  }

  // The party as the UI lists it: who is seated, where each member stands, and the
  // motivation stack that explains what it does on its own (#310).
  function partyView(snapshot) {
    return partyIds.map((id) => {
      const actor = snapshot.actors.find((entry) => entry.id === id);
      const memberStatus = statusOf(id);
      return {
        id,
        label: labels.get(id) ?? null,
        active: id === activeId,
        ...(actor && !memberStatus.exited ? { position: { ...actor.position } } : {}),
        motivations: [...(actor?.motivations ?? [])],
        status: memberStatus,
      };
    });
  }

  /**
   * The casts of the last tick (#463), as core's turn recorded them: who cast what at whom,
   * what changed on whom, and each path cell with its arrow. Under fog only the cells the
   * seated actor sees are kept, and a cast is shown when any of it is seen or it involves
   * that actor.
   */
  function rawCasts() {
    const frames = typeof runtime.getTickFrames === "function" ? runtime.getTickFrames() : [];
    return frames.filter((frame) => frame?.phaseDetail === "apply").at(-1)?.emittedSnapshot?.view?.turn?.casts ?? [];
  }

  function castsView(snapshot, visible) {
    return rawCasts().flatMap((cast) => {
      const source = snapshot.actors.find((actor) => actor.id === cast.sourceId);
      if (!source) return [];
      const path = cast.path.map((cell, index) => ({ x: cell.x, y: cell.y,
        glyph: asciiCastPathGlyph(index === 0 ? source.position : cast.path[index - 1], cell, cast.expression) }))
        .filter((cell) => !visible || visible[cell.y]?.[cell.x]);
      const involved = cast.sourceId === activeId || cast.targetId === activeId;
      if (path.length === 0 && !involved) return [];
      return [{
        sourceId: cast.sourceId,
        sourceLabel: labels.get(cast.sourceId) ?? null,
        kind: cast.kind,
        expression: cast.expression,
        ...(cast.targetId ? { targetId: cast.targetId, targetLabel: labels.get(cast.targetId) ?? null } : {}),
        path,
        changes: cast.changes.map((change) => ({ ...change })),
      }];
    });
  }

  /**
   * What hit each actor last tick and what it regenerated, per vital (#410), as core's turn
   * recorded them: a hit regen cancels still shows. Kept to the seated actor and the living
   * actors it sees, with the vital's pool after the tick.
   */
  function vitalChangesView(snapshot, visible) {
    const frames = typeof runtime.getTickFrames === "function" ? runtime.getTickFrames() : [];
    const changes = frames.filter((frame) => frame?.phaseDetail === "apply").at(-1)?.emittedSnapshot?.view?.turn?.vitalChanges ?? [];
    return changes.flatMap((change) => {
      const actor = snapshot.actors.find((entry) => entry.id === change.actorId);
      const pool = actor?.vitals?.[change.vital];
      if (!actor || !pool || actor.lifecycle !== "alive") return [];
      if (actor.id !== activeId && visible && !visible[actor.position.y]?.[actor.position.x]) return [];
      return [{ actorId: actor.id, label: labels.get(actor.id) ?? null, vital: change.vital,
        hit: change.hit, regen: change.regen, current: pool.current, max: pool.max }];
    });
  }

  function view() {
    const fogOn = fog && !runtime.hasActorExited(activeId);
    const snapshot = readSnapshot();
    const built = buildPlayView({
        snapshot,
      presentation,
      legend,
      playerId: activeId,
      glyphSet,
      tick: currentTick(),
      status: status(),
      visible: fogOn ? readVisible() : null,
      explored: fogOn ? explored.get(activeId) ?? null : null,
      // #416: with fog, others show what light reveals of them; your own party, everything.
      reveal: fogOn && typeof runtime.readRevealLevels === "function"
        ? Object.fromEntries(Object.entries(runtime.readRevealLevels(activeId)).filter(([id]) => !partyIds.includes(id)))
        : null,
      labels,
      field: typeof runtime.readFieldCells === "function" ? runtime.readFieldCells() : null,
        upkeepTable: typeof runtime.readAffinityUpkeepTable === "function" ? runtime.readAffinityUpkeepTable() : [],
        castPrices,
    });
    return {
      ...built,
      party: partyView(snapshot),
      inspections: inspectionsView(snapshot, fogOn ? readVisible() : null),
      lastSeen: lastSeenView(built.actors, snapshot, fogOn ? readVisible() : null),
      casts: castsView(snapshot, fogOn ? readVisible() : null),
      vitalChanges: vitalChangesView(snapshot, fogOn ? readVisible() : null),
      departures: departures.map((entry) => ({ ...entry })),
      defeatMarks: defeatMarks.filter((mark) => !fogOn || readVisible()?.[mark.y]?.[mark.x]).map((mark) => ({ ...mark })),
      orders: ordersView(),
      orderable: orderableView(snapshot),
      battleLog: battleLogView(),
    };
  }

  /**
   * #500: the whole level as the analysis console shows it, with no fog and no revealing:
   * every actor in full, the field on every cell, the event log. For evaluation only; the
   * player-facing `view()` never carries any of it.
   */
  function debugView() {
    return {
      tick: currentTick(),
      seed: simConfig.seed ?? 0,
      budgetReceiptRef: simConfig.budgetReceiptRef ?? null,
      actionCosts: simConfig.actionCosts ? structuredClone(simConfig.actionCosts) : null,
      // #514: the build's receipt and price list when the caller loaded them (evaluation only).
      costing: costing ? structuredClone(costing) : null,
      actors: readSnapshot().actors.map((actor) => ({ ...structuredClone(actor), label: labels.get(actor.id) ?? null,
        role: categoryOf(actor, presentation) ?? null, exited: runtime.hasActorExited(actor.id) })),
      field: typeof runtime.readFieldCells === "function" ? structuredClone(runtime.readFieldCells()) : null,
      events: eventLog.map((entry) => structuredClone(entry)),
    };
  }

  /** The played commands as a CapturedInputArtifact; `meta` comes from the caller (no clock here). */
  function captureInput({ meta } = {}) {
    if (!meta || ["id", "runId", "createdAt"].some((key) => typeof meta[key] !== "string" || !meta[key])) {
      throw new Error("captureInput: meta with id, runId and createdAt is required");
    }
    return {
      schema: CAPTURED_INPUT_SCHEMA,
      schemaVersion: 1,
      meta: { producedBy: "play-session", ...meta },
      source: { adapter: PLAYER_CAPTURE_ADAPTER },
      contentType: "application/json",
      payload: { playerActorId: playerId, activeActorId: activeId, commands: structuredClone(commandLog) },
    };
  }

  return {
    act,
    order,
    advance,
    autoTick,
    strategies,
    view,
    status,
    switchTo,
    resolveActorRef,
    activeActorId: () => activeId,
    debugView,
    captureInput,
    playerActorId: playerId,
    viabilityReport,
    pricingReport,
  };
}


// The registry's terrain in the level's legend: base tiles, then the frame with
// living barriers and the player drawn in.
function renderBoard(snapshot, { presentation, legend, playerId, glyphSet }) {
  const { width, height } = snapshot.dimensions;
  // Walls join their wall neighbours (#574) unless the level draws walls its own way.
  const wallAt = legend.wall === ASCII_TERRAIN_GLYPHS.wall
    ? wallGlyphAt(width, height, (x, y) => snapshot.terrain[y * width + x] === "wall", glyphSet)
    : () => null;
  const baseTiles = [];
  for (let y = 0; y < height; y += 1) {
    let row = "";
    for (let x = 0; x < width; x += 1) row += wallAt(x, y) ?? legend[snapshot.terrain[y * width + x]] ?? legend.floor;
    baseTiles.push(row);
  }
  const grid = baseTiles.map((row) => row.split(""));
  for (const actor of snapshot.actors) {
    if (actor.lifecycle !== "alive") continue;
    if (categoryOf(actor, presentation) === BARRIER_CATEGORY) grid[actor.position.y][actor.position.x] = legend.barrier;
  }
  const player = snapshot.actors.find((actor) => actor.id === playerId && actor.lifecycle !== "exited");
  if (player) grid[player.position.y][player.position.x] = legend.actor;
  return { baseTiles, buffer: grid.map((cells) => cells.join("")) };
}

// Fog over the board. Without a sight grid (no fog, or the player has left the map) nothing is hidden.
function applyFog(frame, visible, explored) {
  if (!visible || !explored) {
    return { rows: frame.buffer.slice(), sight: frame.buffer.map((row) => PLAY_SIGHT.VISIBLE.repeat(row.length)), visible: null };
  }
  const rows = [];
  const sight = [];
  frame.buffer.forEach((bufferRow, y) => {
    let row = "";
    let sightRow = "";
    for (let x = 0; x < bufferRow.length; x += 1) {
      if (visible[y]?.[x]) {
        row += bufferRow[x];
        sightRow += PLAY_SIGHT.VISIBLE;
      } else if (explored[y]?.[x]) {
        row += frame.baseTiles[y][x];
        sightRow += PLAY_SIGHT.REMEMBERED;
      } else {
        row += ASCII_FOG_GLYPH;
        sightRow += PLAY_SIGHT.UNKNOWN;
      }
    }
    rows.push(row);
    sight.push(sightRow);
  });
  return { rows, sight, visible };
}

// One actor as the UI sees it: plain data, vitals as records, the active pair named.
// `revealLevel` is core's reveal level for this actor (#416), or undefined when everything
// shows (no fog, or one's own party). At 0 only its glyph and role show (and its colour,
// the kind it has equipped); above 0 its properties show, and any affinity range or
// intensity above the level reads as the level with a `+` (core's `revealedValue`).
export function toViewActor(actor, presentation, labels, revealLevel, upkeepTable = []) {
  const category = categoryOf(actor, presentation) ?? null;
  // Off (#412): every equipped slot ran out of mana and waits for a full pool, so the
  // source has no field; read through core's helpers, never recomputed.
  const equipped = equippedActorAffinityKeys(actor);
  const exhausted = exhaustedActorAffinityKeys(actor);
  const off = equipped.length > 0 && equipped.every((key) => exhausted.includes(key));
  // #454: off for good when full mana can't pay any of its off slots; the dearest upkeep is named.
  const unpayable = off ? unpayableActorAffinities(actor, upkeepTable).filter((entry) => exhausted.includes(entry.key)) : [];
  const offForGood = unpayable.length > 0 && unpayable.length === exhausted.filter((key) => equipped.includes(key)).length;
  const shown = {
    id: actor.id,
    ...(labels?.has(actor.id) ? { label: labels.get(actor.id) } : {}),
    role: category,
    position: { ...actor.position },
    activeAffinityKey: actor.activeAffinityKey,
    ...(actor.affinityExhausted ? { affinityExhausted: true } : {}),
    ...(off ? { affinityOff: true } : {}),
    ...(offForGood ? { affinityUnpayable: { upkeep: Math.max(...unpayable.map((entry) => entry.upkeep)), maxMana: actor.vitals.mana?.max ?? 0 } } : {}),
    // Soaked (#420): turns left during which each move costs more stamina; plain to see.
    ...(actor.soaked ? { soaked: actor.soaked } : {}),
  };
  if (revealLevel === 0) return { ...shown, revealed: 0 };
  const capped = (value) => (revealLevel === undefined ? value : revealedValue(value, revealLevel));
  return {
    ...shown,
    ...(revealLevel !== undefined ? { revealed: revealLevel } : {}),
    vitals: structuredClone(actor.vitals),
    affinities: actor.affinities.map((pair) => ({ ...pair, stacks: capped(pair.stacks),
      ...(pair.intensity !== undefined || revealLevel !== undefined ? { intensity: capped(pair.intensity ?? 1) } : {}) })),
    // The stack that explains its behaviour (#310); the board glyph never encodes it.
    motivations: [...(actor.motivations ?? [])],
  };
}

// Holdings are core's data: authored ones, plus one per affinity once an actor is defeated.
// Core says whose may be taken (a defeated actor's, or an intact resource's, #406); this only
// lists them, by actor id, in the shape a take command needs.
const holdsUnclaimed = (actor) => (Array.isArray(actor.holdings) ? actor.holdings : []).some((holding) => holding.claimedBy === null);
// A resource still has something to give while it holds an unclaimed holding or, intact, an
// affinity (core derives that reward when it is broken).
const hasLoot = (actor) => holdsUnclaimed(actor) || (actor.lifecycle === "alive" && Array.isArray(actor.affinities) && actor.affinities.length > 0);
const isSpent = (actor, presentation) => categoryOf(actor, presentation) === RESOURCE_CATEGORY && !hasLoot(actor);

function lootNextTo(snapshot, player) {
  const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return snapshot.actors
    .filter((actor) => actor.id !== player.id && actorHoldingsOpen(actor) && Array.isArray(actor.holdings)
      && Math.max(Math.abs(actor.position.x - player.position.x), Math.abs(actor.position.y - player.position.y)) <= 1)
    .sort(byId)
    .flatMap((actor) => actor.holdings
      .filter((holding) => holding.claimedBy === null)
      .map((holding) => ({
        targetId: actor.id,
        holdingId: holding.id,
        kind: holding.kind,
        ...(holding.kind === "affinity" ? { affinity: holding.affinity, expression: holding.expression } : {}),
        // #487: what a vital grant changes, so the take message can name it; and whether the
        // source stays on the floor (an intact resource keeps standing once its holdings go).
        ...(holding.kind === "vital" ? { permanenceMode: holding.permanenceMode, vitals: holding.vitals.map((grant) => ({ ...grant })) } : {}),
        ...(actor.lifecycle === "alive" ? { intact: true } : {}),
        position: { ...actor.position },
      })));
}

/**
 * The board and HUD data a UI draws, from one actor-registry snapshot. Pure, so
 * a live session (`createPlaySession().view()`) and a recorded run
 * (`runner/run-viewer.js`) give the UI the same shape. `visible` and `explored`
 * are the fog grids; pass neither for a view with nothing hidden.
 *
 * @param {object} args
 * @param {object} args.snapshot      an actor-registry snapshot (dimensions, terrain, actors)
 * @param {object} args.presentation  actor id -> { category }
 * @param {object} args.legend        terrain kind -> glyph, plus `actor` (the player) and `barrier`
 * @param {string} args.playerId      the actor drawn as the player
 * @param {string}   [args.glyphSet] "unicode" (default) or "ascii" wall glyphs
 * @param {number} args.tick
 * @param {object} args.status        { tick, exited, atExit, defeated }
 * @param {Map}    [args.labels]      actor id -> short label; worked out from the snapshot when absent
 */
export function buildPlayView({ snapshot, presentation = {}, legend: baseLegend, playerId, tick, status, visible = null, explored = null, labels = playActorLabels(snapshot.actors, presentation), field = null, reveal = null, upkeepTable = [], castPrices = undefined, glyphSet = "unicode" }) {
  // Actor glyphs (#575) come from the glyph set; the table rides on the legend for every UI to read.
  const glyphs = actorGlyphs(glyphSet);
  const legend = { ...baseLegend, ...(baseLegend.barrier === ASCII_TERRAIN_GLYPHS.barrier ? { barrier: glyphs.barrier } : {}) };
  const frame = renderBoard(snapshot, { presentation, legend, playerId, glyphSet });
  const fogged = applyFog(frame, visible, explored);
  const inSight = (actor) => !fogged.visible || Boolean(fogged.visible[actor.position?.y]?.[actor.position?.x]);
  const player = snapshot.actors.find((actor) => actor.id === playerId && actor.lifecycle !== "exited") || null;
  const others = snapshot.actors.filter((actor) => actor.id !== playerId && actor.lifecycle === "alive"
    && categoryOf(actor, presentation) !== BARRIER_CATEGORY && inSight(actor));
  return {
    tick,
    rows: fogged.rows,
    sight: fogged.sight,
    // Every affinity field on each cell (#287), only where the player sees now: a remembered
    // or unknown cell shows no live field, except the reach of the player's own (Darren,
    // 2026-10-29: you know where your own aura reaches; it tells you nothing about the cell).
    field: playField(field, fogged.visible, player?.id),
    legend: { ...legend, glyphs, fog: ASCII_FOG_GLYPH, wallGlyphs: legend.wall === ASCII_TERRAIN_GLYPHS.wall ? wallGlyphChars(glyphSet) : [] },
    status,
    // With fog, only traps in sight right now.
    hazards: others.filter((actor) => categoryOf(actor, presentation) === HAZARD_CATEGORY)
      .map((actor) => toViewActor(actor, presentation, labels, reveal?.[actor.id], upkeepTable)),
    player: player
      ? {
        ...buildActorHudModel({ ...toViewActor(player, presentation, labels, undefined, upkeepTable), role: categoryOf(player, presentation) }),
        ...(labels.has(player.id) ? { label: labels.get(player.id) } : {}),
        affinities: player.affinities.map((pair) => ({ ...pair })),
        activeAffinityKey: player.activeAffinityKey,
        ...(player.affinityExhausted ? { affinityExhausted: true } : {}),
        ...(player.soaked ? { soaked: player.soaked } : {}),
        // Equipped slots, read through core's helpers: the count (1 when unset), the
        // equipped keys in equip order, the lasting ones off until mana is full, and
        // the range and intensity of slots run below what is held (#230, #345; full when
        // a key is absent).
        affinitySlots: player.affinitySlots ?? 1,
        equippedAffinityKeys: equippedActorAffinityKeys(player),
        exhaustedAffinityKeys: exhaustedActorAffinityKeys(player),
        // #454: off slots whose upkeep is above max mana never come back; each with its upkeep.
        unpayableAffinities: unpayableActorAffinities(player, upkeepTable)
          .map((entry) => ({ ...entry, maxMana: player.vitals.mana?.max ?? 0 })),
        equippedAffinityStacks: { ...(player.equippedAffinityStacks ?? {}) },
        equippedAffinityIntensity: { ...(player.equippedAffinityIntensity ?? {}) },
        // Core's rules, stated as data so the UI never restates them: which equipped
        // slots can be cast, how far each reaches and what one cast costs, and the most slots anyone holds.
        castableAffinities: actorCastableAffinities(player, castPrices),
        maxAffinitySlots: MAX_AFFINITY_SLOTS,
        position: { ...player.position },
      }
      : null,
    // What the player could `take` this turn: unclaimed holdings of defeated actors and
    // intact resources next to it. Whether a take succeeds is still core's call.
    loot: player && player.lifecycle === "alive" ? lootNextTo(snapshot, player) : [],
    // Every OTHER living actor in sight (id, role, position, vitals, affinities), for the
    // UI to draw over the board. Traps are reported in `hazards` instead. A resource with
    // nothing left to take is gone from the board (Darren, 2026-10-30); the session marks
    // where it was for a few ticks.
    actors: others.filter((actor) => categoryOf(actor, presentation) !== HAZARD_CATEGORY && !isSpent(actor, presentation))
      .map((actor) => toViewActor(actor, presentation, labels, reveal?.[actor.id], upkeepTable)),
    // Darren, 2026-10-30 ("show it as a resource"): a defeated actor in sight that still holds
    // something to take is shown as a resource until it is emptied. Taking is core's rule as before.
    lootBodies: snapshot.actors.filter((actor) => actor.id !== playerId && actor.lifecycle === "defeated"
      && categoryOf(actor, presentation) !== BARRIER_CATEGORY && holdsUnclaimed(actor) && inSight(actor))
      .map((actor) => ({ id: actor.id, ...(labels.has(actor.id) ? { label: labels.get(actor.id) } : {}),
        role: RESOURCE_CATEGORY, position: { ...actor.position } })),
  };
}

// #485: whether a field helps or harms, and which vital, from the one affinity table (never per kind).
function withHelp(entry) {
  const row = AFFINITY_TABLE.find((candidate) => candidate.kind === entry.kind);
  return { ...entry, ...(entry.sources ? { sources: [...entry.sources] } : {}),
    ...(row ? { restores: row.outward === "restore", vital: row.primaryVital } : {}) };
}

/**
 * Core's per-cell field grid, emptied outside the visible set (all of it without fog). Out of
 * sight, a cell keeps only the kind of the viewer's own field there, marked `own`: no strength,
 * and no other source.
 */
function playField(field, visible, viewerId = null) {
  if (!Array.isArray(field) || field.length === 0) return null;
  return field.map((row, y) => row.map((cell, x) => {
    if (!visible || visible[y]?.[x]) return cell.map((entry) => withHelp(entry));
    return viewerId ? cell.filter((entry) => entry.sources?.includes(viewerId))
      .map((entry) => withHelp({ kind: entry.kind, sources: [viewerId], own: true })) : [];
  }));
}

/**
 * Where the player stands, read from a snapshot: gone (`exited`, core's exit-dwell
 * rule), standing on exit terrain (`atExit`), or `defeated` (core's lifecycle verdict,
 * read here, never recomputed).
 */
export function playStatus({ snapshot, playerId, exited, tick }) {
  const player = exited ? null : snapshot.actors.find((actor) => actor.id === playerId);
  const terrain = player ? snapshot.terrain[player.position.y * snapshot.dimensions.width + player.position.x] : null;
  const atExit = Boolean(player && player.lifecycle === "alive" && terrain === "exit");
  const defeated = Boolean(player && player.lifecycle === "defeated");
  return { tick, exited: Boolean(exited), atExit, defeated };
}

/**
 * The legend a level's board is drawn with: the render vocabulary, the level's
 * own `layout.data.render` overrides, and `@` for the player.
 */
export function playLegend(simConfig) {
  return { ...ASCII_TERRAIN_GLYPHS, ...(simConfig?.layout?.data?.render || {}), actor: "@" };
}

/**
 * The actor a play view centres on when the caller names none: the first (by id)
 * `user_controlled` actor, else the first delver, else the first actor.
 */
export function defaultPlayerActorId(initialState) {
  const sourceActors = (Array.isArray(initialState?.actors) ? initialState.actors : [])
    .filter((actor) => typeof actor?.id === "string" && actor.id);
  const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const categoryOf = (id) => initialState.presentation?.[id]?.category ?? null;
  return (sourceActors.filter((actor) => actor.motivations?.includes?.(PLAYER_MOTIVATION)).sort(byId)[0]
    ?? sourceActors.filter((actor) => categoryOf(actor.id) === "delver").sort(byId)[0]
    ?? sourceActors.slice().sort(byId)[0])?.id;
}

/** Every actor authored `user_controlled`, by id: the actors a player may seat. */
export function playableActorIds(initialState) {
  return (Array.isArray(initialState?.actors) ? initialState.actors : [])
    .filter((actor) => typeof actor?.id === "string" && actor.id && actor.motivations?.includes?.(PLAYER_MOTIVATION))
    .map((actor) => actor.id)
    .sort(compareIds);
}

// Natural order, so "w-2" comes before "w-10".
function compareIds(a, b) {
  return a.localeCompare(b, "en", { numeric: true });
}

const LABEL_LETTERS = Object.freeze({ delver: "D", warden: "W", hazard: "H", barrier: "B", resource: "R" });

/**
 * Short, stable names for a level's actors: the role's letter and the actor's place
 * among that role in id order (`D1`, `W2`, `H3`; `A` for an actor with no role).
 * They depend only on the level, so they never change during a game.
 */
export function playActorLabels(actors, presentation = {}) {
  const counts = new Map();
  const labels = new Map();
  const ids = (Array.isArray(actors) ? actors : []).map((actor) => actor?.id).filter((id) => typeof id === "string" && id);
  for (const id of [...new Set(ids)].sort(compareIds)) {
    const letter = LABEL_LETTERS[presentation[id]?.category] ?? "A";
    const n = (counts.get(letter) ?? 0) + 1;
    counts.set(letter, n);
    labels.set(id, `${letter}${n}`);
  }
  return labels;
}

export const PLAYER_CAPTURE_ADAPTER = "player";

/**
 * Re-run a captured game on its level: a fresh session that acts each logged
 * command in order. Throws when the capture is not a player capture, or when a
 * command lands on a different tick than it did when played, which means the
 * level or the rules changed since.
 */
export async function replayPlaySession({ simConfig, initialState, capturedInput, ...options } = {}) {
  if (capturedInput?.schema !== CAPTURED_INPUT_SCHEMA || capturedInput?.source?.adapter !== PLAYER_CAPTURE_ADAPTER) {
    throw new Error("replayPlaySession: capturedInput is not a player capture");
  }
  const { playerActorId, activeActorId, commands } = capturedInput.payload ?? {};
  if (!Array.isArray(commands)) throw new Error("replayPlaySession: capture has no commands");
  const session = await createPlaySession({ simConfig, initialState, playerActorId, ...options });
  for (const entry of commands) {
    let result;
    // Orders and auto ticks depend on who was seated, so the replay reseats first.
    if (entry.order !== undefined) {
      if (entry.seat !== undefined) session.switchTo(entry.seat);
      result = await session.order(entry.actorId, entry.order);
    } else if (entry.auto) {
      session.switchTo(entry.actorId);
      result = await session.autoTick(entry.actorId);
    }
    else result = await session.act(entry.command, { actorId: entry.actorId ?? playerActorId });
    if (result.tick !== entry.tick) {
      throw new Error(`replayPlaySession: command for tick ${entry.tick} ran at tick ${result.tick}; the level does not match this capture`);
    }
  }
  if (activeActorId !== undefined) session.switchTo(activeActorId);
  return session;
}
