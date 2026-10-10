/**
 * play-session.js — a single-player, step-at-a-time driver over the core.
 *
 * Every other driver in the repo runs to completion and hands back recorded
 * frames (`createPlaybackRuntime`, `runMvpMovement`); a UI then scrubs them. An
 * interactive surface needs the opposite: one player command, one closed tick,
 * one fresh frame. This module is that seam, so a UI (`packages/ui-ascii`)
 * never has to reach into `core-ts` itself — the charter keeps UI code on
 * runtime helpers.
 *
 * Its shape — `await createPlaySession(...)`, `await act(command)`, `view()`,
 * `status()` — is the one the player-command seam design names
 * (project note `player-command-seam.md`). This version drives core directly,
 * so only the player acts. When `runtime.step({ actorCommands })` lands, `act`
 * becomes that step and NPCs take their turns; callers do not change.
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
 * `mvp/movement.js` — it closes its own tick after every command (charter §29:
 * whoever drives the simulation advances it). A rejected move still costs the
 * turn, as it will once other actors act on the same tick.
 */
import { getValidationErrorName, ValidationError } from "../../../core-ts/src/index.ts";
import { EffectKind } from "../ports/effects.js";
import { EIGHT_WAY_DELTAS } from "../personas/_shared/movement-directions.js";
import { buildActorHudModel } from "../render/actor-hud-model.js";
import { initializeCoreFromArtifacts } from "./core-setup.mjs";
import { applyCoreMove, createRuntimeCore, readCoreObservation, renderCoreFrame } from "./core-facade.js";

export const PLAY_COMMAND_KINDS = Object.freeze(["move", "wait"]);

const DELTA_BY_DIRECTION = Object.freeze(
  Object.fromEntries(EIGHT_WAY_DELTAS.map((delta) => [delta.direction, delta])),
);

export const PLAY_DIRECTIONS = Object.freeze(EIGHT_WAY_DELTAS.map((delta) => delta.direction));

// Core numbers motivated actors from 1 in placement order, and core-setup places
// the id-sorted actors in that order: the playable actor is the primary, index 0.
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

/** Shape check only: what the command means is core's to decide. */
export function normalizePlayCommand(command) {
  const resolved = command ?? { kind: "wait" };
  if (!PLAY_COMMAND_KINDS.includes(resolved.kind)) {
    throw new Error(`play-session: unknown command kind "${resolved.kind}"`);
  }
  if (resolved.kind === "move" && !DELTA_BY_DIRECTION[resolved.params?.direction]) {
    throw new Error(`play-session: unknown direction "${resolved.params?.direction}"`);
  }
  return resolved.kind === "move"
    ? { kind: "move", params: { direction: resolved.params.direction } }
    : { kind: "wait" };
}

/**
 * @param {object} args
 * @param {object} args.simConfig      agent-kernel/SimConfigArtifact
 * @param {object} args.initialState   agent-kernel/InitialStateArtifact
 * @param {string} [args.playerActorId] defaults to the primary (id-sorted first) actor
 * @param {object} [args.core]         a core to drive; a fresh one by default
 */
export async function createPlaySession({
  simConfig,
  initialState,
  playerActorId,
  core = createRuntimeCore(),
} = {}) {
  if (!simConfig || !initialState) {
    throw new Error("createPlaySession: simConfig and initialState are required");
  }
  const setup = initializeCoreFromArtifacts(core, { simConfig, initialState });
  if (!setup?.layout?.ok || !setup?.actor?.ok) {
    const reason = setup?.layout?.ok ? setup?.actor?.reason : setup?.layout?.reason;
    throw new Error(`createPlaySession: level did not load (${reason || "unknown"})`);
  }
  const primaryId = setup.actor.actorId;
  if (playerActorId !== undefined && playerActorId !== primaryId) {
    // Core's direct-drive surface addresses the primary actor only; any other
    // actor becomes playable with the persona-routed step.
    throw new Error(`createPlaySession: only the primary actor "${primaryId}" can be played`);
  }
  clearCoreEffects(core);

  const playerId = primaryId;
  const playerSource = (initialState.actors || []).find((actor) => actor?.id === playerId) || {};
  let atExit = false;

  function readPlayer() {
    return readCoreObservation(core).actors?.[PLAYER_INDEX] || null;
  }

  function status() {
    const exited = Boolean(core.isMotivatedActorExitedByIndex?.(PLAYER_INDEX));
    return { tick: core.getCurrentTick(), exited, atExit: !exited && atExit };
  }

  function closeTick() {
    core.advanceTick();
    clearCoreEffects(core);
  }

  async function act(command) {
    const normalized = normalizePlayCommand(command);
    const tick = core.getCurrentTick() + 1;
    const action = { actorId: playerId, tick, kind: normalized.kind, params: { ...normalized.params } };
    if (status().exited) {
      return { tick: core.getCurrentTick(), accepted: [], rejected: [{ ...action, reason: "exited" }], status: status() };
    }
    const accepted = [];
    const rejected = [];
    if (normalized.kind === "move") {
      const delta = DELTA_BY_DIRECTION[normalized.params.direction];
      const from = readPlayer().position;
      const to = { x: from.x + delta.dx, y: from.y + delta.dy };
      Object.assign(action.params, { from, to });
      clearCoreEffects(core);
      const code = applyCoreMove(core, { actorId: PLAYER_CORE_ID, from, to, direction: action.params.direction, tick });
      if (code === ValidationError.None) {
        atExit = readCoreEffectKinds(core).includes(EffectKind.LimitReached);
        accepted.push(action);
      } else {
        rejected.push({ ...action, code, reason: getValidationErrorName(code) });
      }
    } else {
      accepted.push(action);
    }
    closeTick();
    return { tick: core.getCurrentTick(), accepted, rejected, status: status() };
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

  return { act, view, status, playerActorId: playerId };
}
