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
 *     runtime). This session only REMEMBERS: a cell the player has seen once
 *     stays explored. view() then applies fog: a never-seen cell is the fog
 *     glyph, an explored cell out of sight shows its base tile (no actors), and
 *     `sight` tells the UI which cells to dim.
 */
import { ACTOR_COMMAND_KINDS, normalizeActorCommand } from "../personas/actor/persona.js";
import { EIGHT_WAY_DELTAS } from "../personas/_shared/movement-directions.js";
import { buildActorHudModel } from "../render/actor-hud-model.js";
import { ASCII_TERRAIN_GLYPHS } from "../render/visualization-snapshot.js";
import { createPlaybackRuntime, createRuntimeCore } from "./core-facade.js";

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
  const legend = { ...ASCII_TERRAIN_GLYPHS, ...(simConfig.layout?.data?.render || {}), actor: "@" };

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
    return { tick: currentTick(), exited, atExit };
  }

  async function act(command) {
    const normalized = normalizePlayCommand(command);
    if (status().exited) {
      const action = { actorId: playerId, tick: currentTick() + 1, kind: normalized.kind, params: { ...normalized.params } };
      return { tick: currentTick(), accepted: [], rejected: [{ ...action, reason: "exited" }], status: status() };
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
          row += FOG_GLYPH;
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
      legend: { ...legend, fog: FOG_GLYPH },
      status: status(),
      // With fog, only traps in sight right now.
      hazards: others.filter((actor) => presentation[actor.id]?.category === HAZARD_CATEGORY).map(toViewActor),
      player: player
        ? {
          ...buildActorHudModel({ ...toViewActor(player), role: presentation[player.id]?.category ?? null }),
          activeAffinityKey: player.activeAffinityKey,
          position: { ...player.position },
        }
        : null,
      // Every OTHER living actor in sight (id, role, position, vitals, affinities), for the
      // UI to draw over the board. Traps are reported in `hazards` instead.
      actors: others.filter((actor) => presentation[actor.id]?.category !== HAZARD_CATEGORY).map(toViewActor),
    };
  }

  return { act, view, status, playerActorId: playerId };
}
