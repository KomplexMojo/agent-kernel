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
 * **Replay (#204).** Every command that runs a tick is logged as
 * `{ tick, actorId, command }`; `captureInput({ meta })` returns the log as a
 * CapturedInputArtifact (`source.adapter: "player"`), and `replayPlaySession`
 * re-runs it on the same level. The simulation is deterministic, so a replay
 * reaches the same state. Writing the artifact to disk is the caller's job.
 */
import { ACTOR_COMMAND_KINDS, normalizeActorCommand } from "../personas/actor/persona.js";
import { createConfiguratorPersona } from "../personas/configurator/persona.js";
import { UNUSED_CLOCK } from "../personas/_shared/require-clock.js";
import { EIGHT_WAY_DELTAS } from "../personas/_shared/movement-directions.js";
import { buildActorHudModel } from "../render/actor-hud-model.js";
import { ASCII_FOG_GLYPH, ASCII_TERRAIN_GLYPHS } from "../render/visualization-snapshot.js";
import { createPlaybackRuntime, createRuntimeCore } from "./core-facade.js";
import { CAPTURED_INPUT_SCHEMA } from "../contracts/artifacts.ts";
import { equippedActorAffinityKeys, exhaustedActorAffinityKeys, MAX_AFFINITY_SLOTS } from "../../../core-ts/src/state/actor-inventory.ts";
import { actorCastableAffinities } from "../../../core-ts/src/rules/actor-cast.ts";

export const PLAY_COMMAND_KINDS = ACTOR_COMMAND_KINDS;

/** Per-cell sight in `view().sight`: seen now, seen before, never seen. */
export const PLAY_SIGHT = Object.freeze({ VISIBLE: "v", REMEMBERED: "r", UNKNOWN: "u" });

// Whether a loaded level's actors meet the viability floor is the Configurator's question.
const reportActorViabilityFloor = createConfiguratorPersona({ clock: UNUSED_CLOCK })
  .authorCandidates.reportActorViabilityFloor;

export const PLAY_DIRECTIONS = Object.freeze(EIGHT_WAY_DELTAS.map((delta) => delta.direction));

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
const PLAYER_MOTIVATION = "user_controlled";

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
  const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const categoryOf = (id) => initialState.presentation?.[id]?.category ?? null;
  const defaultPlayer = sourceActors.filter((actor) => actor.motivations?.includes?.(PLAYER_MOTIVATION)).sort(byId)[0]
    ?? sourceActors.filter((actor) => categoryOf(actor.id) === "delver").sort(byId)[0]
    ?? sourceActors.slice().sort(byId)[0];
  const playerId = playerActorId ?? defaultPlayer?.id;
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
  const legend = { ...ASCII_TERRAIN_GLYPHS, ...(simConfig.layout?.data?.render || {}), actor: "@" };

  // Explored memory: a cell stays explored once the player has seen it.
  let explored = null;
  // Every command that ran a tick, in order (#204).
  const commandLog = [];

  function readVisible() {
    const grid = runtime.readVisibleCells(playerId);
    return Array.isArray(grid) && grid.length > 0 ? grid : null;
  }

  // Dark invalidates memory (#203): a remembered cell that dark covers and the
  // player cannot see right now is forgotten, back to fog until seen again.
  function rememberVisible() {
    const visible = readVisible();
    if (!visible) return;
    if (!explored) explored = visible.map((row) => row.map(() => 0));
    const dark = runtime.readDarkCells();
    visible.forEach((row, y) => row.forEach((cell, x) => {
      if (cell) explored[y][x] = 1;
      else if (dark[y]?.[x]) explored[y][x] = 0;
    }));
  }

  rememberVisible();

  function readSnapshot() {
    return runtime.getActorSnapshot();
  }

  function currentTick() {
    return runtime.readObservation()?.tick ?? 0;
  }

  function terrainAt(snapshot, position) {
    const { width } = snapshot.dimensions;
    return snapshot.terrain[position.y * width + position.x];
  }

  function status() {
    const snapshot = readSnapshot();
    const exited = runtime.hasActorExited(playerId);
    const player = exited ? null : snapshot.actors.find((actor) => actor.id === playerId);
    const atExit = Boolean(player && player.lifecycle === "alive" && terrainAt(snapshot, player.position) === "exit");
    // Defeat is core's verdict (the player's lifecycle), read here, never recomputed.
    const defeated = Boolean(player && player.lifecycle === "defeated");
    return { tick: currentTick(), exited, atExit, defeated };
  }

  async function act(command) {
    const normalized = normalizePlayCommand(command);
    // The game is over once the player has left the level or been defeated: no more ticks.
    const before = status();
    if (before.exited || before.defeated) {
      const action = { actorId: playerId, tick: currentTick() + 1, kind: normalized.kind, params: { ...normalized.params } };
      return { tick: currentTick(), accepted: [], rejected: [{ ...action, reason: before.exited ? "exited" : "defeated" }], status: before };
    }
    await runtime.step({ actorCommands: { [playerId]: normalized } });
    commandLog.push({ tick: currentTick(), actorId: playerId, command: structuredClone(normalized) });
    if (!runtime.hasActorExited(playerId)) rememberVisible();
    const applyFrame = runtime.getTickFrames().filter((frame) => frame?.phaseDetail === "apply").at(-1) || {};
    const accepted = (applyFrame.acceptedActions || [])
      .filter((action) => action?.actorId === playerId && isGameplayAction(action))
      .map(toPlayAction);
    const rejected = (applyFrame.preCoreRejections || [])
      .filter((entry) => entry?.action?.actorId === playerId && isGameplayAction(entry.action))
      .map(toPlayRejection);
    return { tick: currentTick(), accepted, rejected, status: status() };
  }

  // The registry's terrain in the level's legend: base tiles, then the frame with
  // living barriers and the player drawn in.
  function renderBoard(snapshot) {
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
      if (presentation[actor.id]?.category === BARRIER_CATEGORY) grid[actor.position.y][actor.position.x] = legend.barrier;
    }
    const player = snapshot.actors.find((actor) => actor.id === playerId && actor.lifecycle !== "exited");
    if (player) grid[player.position.y][player.position.x] = legend.actor;
    return { baseTiles, buffer: grid.map((cells) => cells.join("")) };
  }

  // Fog over the board. Without a sight grid (the player has left the map) nothing is hidden.
  function applyFog(frame) {
    const visible = !fog || runtime.hasActorExited(playerId) ? null : readVisible();
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
  function toViewActor(actor) {
    const category = presentation[actor.id]?.category ?? null;
    return {
      id: actor.id,
      role: category,
      position: { ...actor.position },
      vitals: structuredClone(actor.vitals),
      affinities: actor.affinities.map((pair) => ({ ...pair })),
      activeAffinityKey: actor.activeAffinityKey,
      ...(actor.affinityExhausted ? { affinityExhausted: true } : {}),
    };
  }

  // Holdings are core's derived data (one per affinity of the defeated actor); this
  // only lists them, by actor id, in the shape a take command needs.
  function lootNextTo(snapshot, player) {
    return snapshot.actors
      .filter((actor) => actor.lifecycle === "defeated" && Array.isArray(actor.holdings)
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

  function view() {
    const snapshot = readSnapshot();
    const frame = renderBoard(snapshot);
    const fogged = applyFog(frame);
    const inSight = (actor) => !fogged.visible || Boolean(fogged.visible[actor.position?.y]?.[actor.position?.x]);
    const player = snapshot.actors.find((actor) => actor.id === playerId && actor.lifecycle !== "exited") || null;
    const others = snapshot.actors.filter((actor) => actor.id !== playerId && actor.lifecycle === "alive"
      && presentation[actor.id]?.category !== BARRIER_CATEGORY && inSight(actor));
    return {
      tick: currentTick(),
      rows: fogged.rows,
      sight: fogged.sight,
      legend: { ...legend, fog: ASCII_FOG_GLYPH },
      status: status(),
      // With fog, only traps in sight right now.
      hazards: others.filter((actor) => presentation[actor.id]?.category === HAZARD_CATEGORY).map(toViewActor),
      player: player
        ? {
          ...buildActorHudModel({ ...toViewActor(player), role: presentation[player.id]?.category ?? null }),
          affinities: player.affinities.map((pair) => ({ ...pair })),
          activeAffinityKey: player.activeAffinityKey,
          ...(player.affinityExhausted ? { affinityExhausted: true } : {}),
          // Equipped slots, read through core's helpers: the count (1 when unset), the
          // equipped keys in equip order, the lasting ones off until mana is full, and
          // the levels of slots run below what is held (#230; full when a key is absent).
          affinitySlots: player.affinitySlots ?? 1,
          equippedAffinityKeys: equippedActorAffinityKeys(player),
          exhaustedAffinityKeys: exhaustedActorAffinityKeys(player),
          equippedAffinityStacks: { ...(player.equippedAffinityStacks ?? {}) },
          // Core's rules, stated as data so the UI never restates them: which equipped
          // slots can be cast and how far each reaches, and the most slots anyone holds.
          castableAffinities: actorCastableAffinities(player),
          maxAffinitySlots: MAX_AFFINITY_SLOTS,
          position: { ...player.position },
        }
        : null,
      // What the player could `take` this turn: unclaimed holdings of defeated actors
      // next to it. Whether a take succeeds is still core's call.
      loot: player && player.lifecycle === "alive" ? lootNextTo(snapshot, player) : [],
      // Every OTHER living actor in sight (id, role, position, vitals, affinities), for the
      // UI to draw over the board. Traps are reported in `hazards` instead.
      actors: others.filter((actor) => presentation[actor.id]?.category !== HAZARD_CATEGORY).map(toViewActor),
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
      payload: { playerActorId: playerId, commands: structuredClone(commandLog) },
    };
  }

  return { act, view, status, captureInput, playerActorId: playerId, viabilityReport };
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
  const { playerActorId, commands } = capturedInput.payload ?? {};
  if (!Array.isArray(commands)) throw new Error("replayPlaySession: capture has no commands");
  const session = await createPlaySession({ simConfig, initialState, playerActorId, ...options });
  for (const entry of commands) {
    const result = await session.act(entry.command);
    if (result.tick !== entry.tick) {
      throw new Error(`replayPlaySession: command for tick ${entry.tick} ran at tick ${result.tick}; the level does not match this capture`);
    }
  }
  return session;
}
