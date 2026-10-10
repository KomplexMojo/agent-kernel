/**
 * play-session.js — a single-player, step-at-a-time driver over the core.
 *
 * Every other driver in the repo runs to completion and hands back recorded
 * frames (`createPlaybackRuntime`, `runMvpMovement`); a UI then scrubs them. An
 * interactive surface needs the opposite: one player-chosen move, one closed
 * tick, one fresh frame. This module is that seam, so a UI (`packages/ui-ascii`)
 * never has to reach into `core-ts` itself — the charter keeps UI code on
 * runtime helpers.
 *
 * It is glue, not rules:
 *   - **Legality is core's.** A move is packed and handed to core; the returned
 *     ValidationError code is reported, never second-guessed.
 *   - **Arrival is core's.** Core emits LimitReached when a move lands the actor
 *     on the exit; leaving the level is core's exit-dwell rule, read back through
 *     `isMotivatedActorExitedByIndex`.
 *   - **Glyphs are core's.** The board is `renderCoreFrame`'s buffer as-is.
 *   - **HUD semantics are runtime render's** (`render/actor-hud-model.js`).
 *
 * Tick close: this module IS the tick loop for its session, so — like
 * `mvp/movement.js` — it closes its own tick after an accepted move or a wait
 * (charter §29: whoever drives the simulation advances it). A rejected move
 * closes nothing, so bumping a wall costs no turn and the next attempt still
 * targets the same tick.
 *
 * No NPC turns: wardens, hazards and resources that act need the Actor
 * persona's player-action seam (see the Actor README), which this does not add.
 */
import { getValidationErrorName, ValidationError } from "../../../core-ts/src/index.ts";
import { EffectKind } from "../ports/effects.js";
import { EIGHT_WAY_DELTAS } from "../personas/_shared/movement-directions.js";
import { buildActorHudModel } from "../render/actor-hud-model.js";
import { initializeCoreFromArtifacts } from "./core-setup.mjs";
import { applyCoreMove, createRuntimeCore, readCoreObservation, renderCoreFrame } from "./core-facade.js";

export const PLAY_STATUS = Object.freeze({
  PLAYING: "playing",
  AT_EXIT: "at_exit",
  ESCAPED: "escaped",
});

const DELTA_BY_DIRECTION = Object.freeze(
  Object.fromEntries(EIGHT_WAY_DELTAS.map((delta) => [delta.direction, delta])),
);

export const PLAY_DIRECTIONS = Object.freeze(EIGHT_WAY_DELTAS.map((delta) => delta.direction));

// Core numbers motivated actors from 1 in placement order, and core-setup places
// the id-sorted actors in that order: the player is the primary actor, index 0.
const PLAYER_INDEX = 0;
const PLAYER_CORE_ID = PLAYER_INDEX + 1;

function readCoreEffectKinds(core) {
  const count = typeof core.getEffectCount === "function" ? core.getEffectCount() : 0;
  const kinds = [];
  for (let i = 0; i < count; i += 1) kinds.push(core.getEffectKind(i));
  return kinds;
}

function clearCoreEffects(core) {
  if (typeof core.clearEffects === "function") core.clearEffects();
}

/**
 * @param {object} args
 * @param {object} args.simConfig   agent-kernel/SimConfigArtifact
 * @param {object} args.initialState agent-kernel/InitialStateArtifact
 * @param {object} [args.core]      a core to drive; a fresh one by default
 */
export function createPlaySession({ simConfig, initialState, core = createRuntimeCore() } = {}) {
  if (!simConfig || !initialState) {
    throw new Error("createPlaySession: simConfig and initialState are required");
  }
  const setup = initializeCoreFromArtifacts(core, { simConfig, initialState });
  if (!setup?.layout?.ok || !setup?.actor?.ok) {
    const reason = setup?.layout?.ok ? setup?.actor?.reason : setup?.layout?.reason;
    throw new Error(`createPlaySession: level did not load (${reason || "unknown"})`);
  }
  clearCoreEffects(core);

  const playerId = setup.actor.actorId;
  const playerSource = (initialState.actors || []).find((actor) => actor?.id === playerId) || {};
  let atExit = false;

  function readPlayer() {
    const observation = readCoreObservation(core);
    return observation.actors?.[PLAYER_INDEX] || null;
  }

  function status() {
    if (core.isMotivatedActorExitedByIndex?.(PLAYER_INDEX)) return PLAY_STATUS.ESCAPED;
    return atExit ? PLAY_STATUS.AT_EXIT : PLAY_STATUS.PLAYING;
  }

  function closeTick() {
    core.advanceTick();
    clearCoreEffects(core);
  }

  function result(accepted, code) {
    return {
      accepted,
      code,
      reason: accepted ? null : getValidationErrorName(code),
      tick: core.getCurrentTick(),
      status: status(),
    };
  }

  function move(direction) {
    const delta = DELTA_BY_DIRECTION[direction];
    if (!delta) {
      throw new Error(`createPlaySession.move: unknown direction "${direction}"`);
    }
    if (status() === PLAY_STATUS.ESCAPED) {
      return { accepted: false, code: null, reason: "escaped", tick: core.getCurrentTick(), status: PLAY_STATUS.ESCAPED };
    }
    const from = readPlayer().position;
    const to = { x: from.x + delta.dx, y: from.y + delta.dy };
    clearCoreEffects(core);
    const code = applyCoreMove(core, {
      actorId: PLAYER_CORE_ID,
      from,
      to,
      direction,
      tick: core.getCurrentTick() + 1,
    });
    if (code !== ValidationError.None) {
      clearCoreEffects(core);
      return result(false, code);
    }
    atExit = readCoreEffectKinds(core).includes(EffectKind.LimitReached);
    closeTick();
    return result(true, code);
  }

  function wait() {
    if (status() !== PLAY_STATUS.ESCAPED) closeTick();
    return result(true, ValidationError.None);
  }

  function view() {
    const frame = renderCoreFrame(core, { actorIdLabel: playerId });
    const player = readPlayer();
    return {
      tick: frame.tick,
      rows: frame.buffer.slice(),
      legend: frame.legend,
      status: status(),
      player: player
        ? {
          ...buildActorHudModel({ ...playerSource, ...player, id: playerId }),
          position: { ...player.position },
        }
        : null,
    };
  }

  return { move, wait, view, status, playerId };
}
