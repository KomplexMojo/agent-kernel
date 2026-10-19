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
import { ACTOR_COMMAND_KINDS, normalizeActorCommand, normalizeActorStrategy } from "../personas/actor/persona.js";
import { createConfiguratorPersona } from "../personas/configurator/persona.js";
import { createAllocatorPersona } from "../personas/allocator/persona.js";
import { UNUSED_CLOCK } from "../personas/_shared/require-clock.js";
import { EIGHT_WAY_DELTAS } from "../personas/_shared/movement-directions.js";
import { buildActorHudModel } from "../render/actor-hud-model.js";
import { ASCII_FOG_GLYPH, ASCII_TERRAIN_GLYPHS } from "../render/visualization-snapshot.js";
import { createPlaybackRuntime, createRuntimeCore } from "./core-facade.js";
import { CAPTURED_INPUT_SCHEMA } from "../contracts/artifacts.ts";
import { equippedActorAffinityKeys, exhaustedActorAffinityKeys, MAX_AFFINITY_SLOTS } from "../../../core-ts/src/state/actor-inventory.ts";
import { actorCastableAffinities } from "../../../core-ts/src/rules/actor-cast.ts";
import { actorHoldingsOpen } from "../../../core-ts/src/state/actor-holdings.ts";

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
 * @param {boolean}  [args.fog]        apply fog of war to view(); off by default so a
 *                                     caller opts in when it draws `sight`
 */
export async function createPlaySession({
  simConfig,
  initialState,
  playerActorId,
  core = createRuntimeCore(),
  clock,
  adapters = {},
  fog = false,
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

  const runtime = createPlaybackRuntime({ core, adapters, clock });
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
  const pricingReport = Object.freeze(createAllocatorPersona({ clock: UNUSED_CLOCK })
    .reportLevelPricing(simConfig).map((finding) => Object.freeze(finding)));
  const legend = playLegend(simConfig);
  const labels = playActorLabels(sourceActors, presentation);
  // The party: every playable actor, and the seated one even when it is not (a caller's choice).
  const partyIds = playableActorIds(initialState);
  if (playerId !== undefined && !partyIds.includes(playerId)) partyIds.unshift(playerId);
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
    await runtime.step({ actorCommands, actorStrategies: { [actorId]: normalized } });
    commandLog.push({ tick: currentTick(), actorId, seat: activeId, order: structuredClone(normalized) });
    rememberParty();
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
      await runtime.step(auto ? {} : { actorCommands: { [activeId]: { kind: "wait" } } });
      commandLog.push(auto ? { tick: currentTick(), actorId: activeId, auto: true }
        : { tick: currentTick(), actorId: activeId, command: { kind: "wait" } });
      rememberParty();
      ran += 1;
    }
    if (ran === ticks && until && reached()) stoppedBy = until;
    return { ticks: ran, stoppedBy, tick: currentTick(), status: status() };
  }

  /** Replay one logged tick the seated actor spent on its own strategy. */
  async function autoTick(actorId) {
    await runtime.step({});
    commandLog.push({ tick: currentTick(), actorId, auto: true });
    rememberParty();
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

  async function act(command, { actorId: actorRef } = {}) {
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
    await runtime.step({ actorCommands: { [actorId]: normalized } });
    commandLog.push({ tick: currentTick(), actorId, command: structuredClone(normalized) });
    rememberParty();
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

  function view() {
    const fogOn = fog && !runtime.hasActorExited(activeId);
    const snapshot = readSnapshot();
    return {
      ...buildPlayView({
        snapshot,
        presentation,
        legend,
        playerId: activeId,
        tick: currentTick(),
        status: status(),
        visible: fogOn ? readVisible() : null,
        explored: fogOn ? explored.get(activeId) ?? null : null,
        labels,
        field: typeof runtime.readFieldCells === "function" ? runtime.readFieldCells() : null,
      }),
      party: partyView(snapshot),
      orders: ordersView(),
      orderable: orderableView(snapshot),
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
    captureInput,
    playerActorId: playerId,
    viabilityReport,
    pricingReport,
  };
}


// The registry's terrain in the level's legend: base tiles, then the frame with
// living barriers and the player drawn in.
function renderBoard(snapshot, { presentation, legend, playerId }) {
  const { width, height } = snapshot.dimensions;
  const baseTiles = [];
  for (let y = 0; y < height; y += 1) {
    let row = "";
    for (let x = 0; x < width; x += 1) row += legend[snapshot.terrain[y * width + x]] ?? legend.floor;
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
function toViewActor(actor, presentation, labels) {
  const category = categoryOf(actor, presentation) ?? null;
  return {
    id: actor.id,
    ...(labels?.has(actor.id) ? { label: labels.get(actor.id) } : {}),
    role: category,
    position: { ...actor.position },
    vitals: structuredClone(actor.vitals),
    affinities: actor.affinities.map((pair) => ({ ...pair })),
    activeAffinityKey: actor.activeAffinityKey,
    ...(actor.affinityExhausted ? { affinityExhausted: true } : {}),
    // The stack that explains its behaviour (#310); the board glyph never encodes it.
    motivations: [...(actor.motivations ?? [])],
  };
}

// Holdings are core's data: authored ones, plus one per affinity once an actor is defeated.
// Core says whose may be taken (a defeated actor's, or an intact resource's, #406); this only
// lists them, by actor id, in the shape a take command needs.
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
        ...(holding.kind === "slot" ? { slots: holding.slots } : {}),
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
 * @param {number} args.tick
 * @param {object} args.status        { tick, exited, atExit, defeated }
 * @param {Map}    [args.labels]      actor id -> short label; worked out from the snapshot when absent
 */
export function buildPlayView({ snapshot, presentation = {}, legend, playerId, tick, status, visible = null, explored = null, labels = playActorLabels(snapshot.actors, presentation), field = null }) {
  const frame = renderBoard(snapshot, { presentation, legend, playerId });
  const fogged = applyFog(frame, visible, explored);
  const inSight = (actor) => !fogged.visible || Boolean(fogged.visible[actor.position?.y]?.[actor.position?.x]);
  const player = snapshot.actors.find((actor) => actor.id === playerId && actor.lifecycle !== "exited") || null;
  const others = snapshot.actors.filter((actor) => actor.id !== playerId && actor.lifecycle === "alive"
    && categoryOf(actor, presentation) !== BARRIER_CATEGORY && inSight(actor));
  return {
    tick,
    rows: fogged.rows,
    sight: fogged.sight,
    // Every affinity field on each cell (#287), only where the player sees now:
    // a remembered or unknown cell shows no live field.
    field: playField(field, fogged.visible),
    legend: { ...legend, fog: ASCII_FOG_GLYPH },
    status,
    // With fog, only traps in sight right now.
    hazards: others.filter((actor) => categoryOf(actor, presentation) === HAZARD_CATEGORY)
      .map((actor) => toViewActor(actor, presentation, labels)),
    player: player
      ? {
        ...buildActorHudModel({ ...toViewActor(player, presentation, labels), role: categoryOf(player, presentation) }),
        ...(labels.has(player.id) ? { label: labels.get(player.id) } : {}),
        affinities: player.affinities.map((pair) => ({ ...pair })),
        activeAffinityKey: player.activeAffinityKey,
        ...(player.affinityExhausted ? { affinityExhausted: true } : {}),
        // Equipped slots, read through core's helpers: the count (1 when unset), the
        // equipped keys in equip order, the lasting ones off until mana is full, and
        // the range and intensity of slots run below what is held (#230, #345; full when
        // a key is absent).
        affinitySlots: player.affinitySlots ?? 1,
        equippedAffinityKeys: equippedActorAffinityKeys(player),
        exhaustedAffinityKeys: exhaustedActorAffinityKeys(player),
        equippedAffinityStacks: { ...(player.equippedAffinityStacks ?? {}) },
        equippedAffinityIntensity: { ...(player.equippedAffinityIntensity ?? {}) },
        // Core's rules, stated as data so the UI never restates them: which equipped
        // slots can be cast and how far each reaches, and the most slots anyone holds.
        castableAffinities: actorCastableAffinities(player),
        maxAffinitySlots: MAX_AFFINITY_SLOTS,
        position: { ...player.position },
      }
      : null,
    // What the player could `take` this turn: unclaimed holdings of defeated actors and
    // intact resources next to it. Whether a take succeeds is still core's call.
    loot: player && player.lifecycle === "alive" ? lootNextTo(snapshot, player) : [],
    // Every OTHER living actor in sight (id, role, position, vitals, affinities), for the
    // UI to draw over the board. Traps are reported in `hazards` instead.
    actors: others.filter((actor) => categoryOf(actor, presentation) !== HAZARD_CATEGORY)
      .map((actor) => toViewActor(actor, presentation, labels)),
  };
}

/** Core's per-cell field grid, emptied outside the visible set (all of it without fog). */
function playField(field, visible) {
  if (!Array.isArray(field) || field.length === 0) return null;
  return field.map((row, y) => row.map((cell, x) =>
    (visible && !visible[y]?.[x] ? [] : cell.map((entry) => ({ ...entry })))));
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
