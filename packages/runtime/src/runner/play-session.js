/**
 * play-session.js — a single-player, step-at-a-time driver an interactive UI uses.
 *
 * Every other driver in the repo runs to completion and hands back recorded
 * frames (`createPlaybackRuntime`, `runMvpMovement`); a UI then scrubs them. An
 * interactive surface needs the opposite: one player command, one tick, one
 * fresh frame. This module is that seam, so a UI (`packages/ui-ascii`) never has
 * to reach into `core-ts` itself — the charter keeps UI code on runtime helpers.
 *
 * Each `act(command)` is one `runtime.step({ actorCommands })`: the player's actor
 * does the command and every other actor takes its own Actor-persona turn in the
 * same tick. A rejected move still costs the turn (maintainer ruling, 2026-10-10).
 *
 * It is glue, not rules:
 *   - **What a command means is the Actor's** (`normalizeActorCommand`); the
 *     Actor turns it into the player's proposal.
 *   - **Legality is core's.** Rejections are reported with core's
 *     ValidationError name and code, never second-guessed.
 *   - **Leaving the level is core's** exit-dwell rule, read back through the
 *     runtime; `atExit` is "standing on core's exit-approach seat", the cell that
 *     rule counts.
 *   - **Glyphs are core's.** The board is `renderCoreFrame`'s buffer as-is; it
 *     draws the primary actor only, so `view().actors` carries everyone else.
 *   - **HUD semantics are runtime render's** (`render/actor-hud-model.js`).
 *   - **Traps are the level's.** Core arms the layout's static hazards at load
 *     and applies them when an actor steps in, but its frame buffer does not
 *     draw them, so `view().hazards` reports them from the SimConfig layout.
 *   - **Sight is core's** (`computeVisibleCells`, read through the runtime).
 *     This session only REMEMBERS: a cell the player has seen once stays
 *     explored. view() then applies fog: a never-seen cell is the fog glyph, an
 *     explored cell out of sight shows its base tile (no actors), and `sight`
 *     tells the UI which cells to dim.
 */
import { ValidationError } from "../../../core-ts/src/index.ts";
import { EIGHT_WAY_DELTAS } from "../personas/_shared/movement-directions.js";
import { ACTOR_COMMAND_KINDS, normalizeActorCommand } from "../personas/actor/persona.js";
import { buildActorHudModel } from "../render/actor-hud-model.js";
import { createPlaybackRuntime, createRuntimeCore, renderCoreFrame } from "./core-facade.js";

export const PLAY_COMMAND_KINDS = ACTOR_COMMAND_KINDS;

/** Per-cell sight in `view().sight`: seen now, seen before, never seen. */
export const PLAY_SIGHT = Object.freeze({ VISIBLE: "v", REMEMBERED: "r", UNKNOWN: "u" });

// The fog tile's board character; `render/resource-bundle.js` already maps "?" to the
// `fog` tile (palette `tiles.fog`).
const FOG_GLYPH = "?";

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

// runtime-fsm prefixes core's ValidationError name ("move_rejected_by_core:BlockedByWall").
function toPlayRejection({ action, reason }) {
  const text = String(reason || "");
  const name = text.slice(text.lastIndexOf(":") + 1) || text;
  const code = Object.prototype.hasOwnProperty.call(ValidationError, name) ? ValidationError[name] : null;
  return { ...toPlayAction(action), code, reason: name };
}

/**
 * @param {object} args
 * @param {object} args.simConfig      agent-kernel/SimConfigArtifact
 * @param {object} args.initialState   agent-kernel/InitialStateArtifact
 * @param {string} [args.playerActorId] any configured actor; defaults to the primary (id-sorted first)
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
  const configuredIds = (Array.isArray(initialState.actors) ? initialState.actors : [])
    .map((actor) => actor?.id)
    .filter((id) => typeof id === "string" && id);
  const primaryId = configuredIds.slice().sort((a, b) => a.localeCompare(b))[0];
  const playerId = playerActorId ?? primaryId;
  if (playerId !== undefined && !configuredIds.includes(playerId)) {
    throw new Error(`createPlaySession: playerActorId "${playerId}" is not an actor in this level`);
  }

  const runtime = createPlaybackRuntime({ core, adapters, clock });
  try {
    await runtime.init({ seed: simConfig.seed ?? 0, simConfig, initialState });
  } catch (error) {
    throw new Error(`createPlaySession: level did not load (${error?.message || "unknown"})`);
  }

  // A blocking hazard is already a barrier in core's buffer.
  const hazards = (simConfig.layout?.data?.hazards || [])
    .filter((hazard) => hazard && typeof hazard === "object" && hazard.blocking !== true)
    .map((hazard) => ({
      ...structuredClone(hazard),
      position: { x: hazard.position?.x ?? hazard.x, y: hazard.position?.y ?? hazard.y },
    }))
    .filter((hazard) => Number.isInteger(hazard.position.x) && Number.isInteger(hazard.position.y));
  // Explored memory: a cell stays explored once the player has seen it.
  let explored = null;

  function readVisible() {
    const grid = runtime.readVisibleCells(playerId);
    return Array.isArray(grid) && grid.length > 0 ? grid : null;
  }

  function rememberVisible() {
    const visible = readVisible();
    if (!visible) return;
    if (!explored) explored = visible.map((row) => row.map(() => 0));
    visible.forEach((row, y) => row.forEach((cell, x) => {
      if (cell) explored[y][x] = 1;
    }));
  }

  const sourceById = new Map((initialState.actors || []).filter((actor) => actor?.id).map((actor) => [actor.id, actor]));
  const playerSource = sourceById.get(playerId) || {};

  rememberVisible();

  function readActors() {
    return runtime.readObservation()?.actors || [];
  }

  function readPlayer() {
    return readActors().find((actor) => actor?.id === playerId) || null;
  }

  function status() {
    const exited = runtime.hasActorExited(playerId);
    const seat = typeof core.getExitApproachPosition === "function" ? core.getExitApproachPosition() : null;
    const position = exited ? null : readPlayer()?.position;
    const atExit = Boolean(position && seat && position.x === seat.x && position.y === seat.y);
    return { tick: core.getCurrentTick(), exited, atExit };
  }

  async function act(command) {
    const normalized = normalizePlayCommand(command);
    if (status().exited) {
      const action = { actorId: playerId, tick: core.getCurrentTick() + 1, kind: normalized.kind, params: { ...normalized.params } };
      return { tick: core.getCurrentTick(), accepted: [], rejected: [{ ...action, reason: "exited" }], status: status() };
    }
    await runtime.step({ actorCommands: { [playerId]: normalized } });
    if (!runtime.hasActorExited(playerId)) rememberVisible();
    const applyFrame = runtime.getTickFrames().filter((frame) => frame?.phaseDetail === "apply").at(-1) || {};
    const accepted = (applyFrame.acceptedActions || [])
      .filter((action) => action?.actorId === playerId && isGameplayAction(action))
      .map(toPlayAction);
    const rejected = (applyFrame.preCoreRejections || [])
      .filter((entry) => entry?.action?.actorId === playerId && isGameplayAction(entry.action))
      .map(toPlayRejection);
    return { tick: core.getCurrentTick(), accepted, rejected, status: status() };
  }

  // Fog over core's frame. Without a sight grid (the player has left the map, or a core
  // without the sight reader) nothing is hidden.
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
          row += frame.baseTiles?.[y]?.[x] ?? bufferRow[x];
          sightRow += PLAY_SIGHT.REMEMBERED;
        } else {
          row += FOG_GLYPH;
          sightRow += PLAY_SIGHT.UNKNOWN;
        }
      }
      rows.push(row);
      sight.push(sightRow);
    });
    return { rows, sight, visible };
  }

  function view() {
    const frame = renderCoreFrame(core, { actorIdLabel: playerId });
    const actors = readActors();
    const player = actors.find((actor) => actor?.id === playerId) || null;
    const fog = applyFog(frame);
    const inSight = (actor) => !fog.visible || Boolean(fog.visible[actor.position?.y]?.[actor.position?.x]);
    return {
      tick: frame.tick,
      rows: fog.rows,
      sight: fog.sight,
      legend: { ...frame.legend, fog: FOG_GLYPH },
      status: status(),
      // With fog, only traps in sight right now.
      hazards: structuredClone(hazards.filter((hazard) => inSight(hazard))),
      player: player
        ? {
          // Core's observation reports `affinities: []` unless it is handed the
          // affinity metadata, which would hide the authored equipped affinity.
          ...buildActorHudModel({
            ...playerSource,
            ...player,
            affinities: player.affinities?.length ? player.affinities : playerSource.affinities,
            id: playerId,
          }),
          position: { ...player.position },
        }
        : null,
      // Every OTHER visible actor (id, role, position, vitals, affinities), for the UI
      // to draw; core's frame shows only the primary actor. Affinities follow the
      // player's rule: core's observed list, else the authored one.
      // Only actors the player can see right now: fog hides the rest.
      actors: actors
        .filter((actor) => actor?.id !== playerId && actor?.position && inSight(actor))
        .map((actor) => ({
          id: actor.id,
          role: actor.role ?? null,
          position: { ...actor.position },
          vitals: actor.vitals,
          affinities: actor.affinities?.length ? actor.affinities : (sourceById.get(actor.id)?.affinities ?? []),
        })),
    };
  }

  return { act, view, status, playerActorId: playerId };
}
