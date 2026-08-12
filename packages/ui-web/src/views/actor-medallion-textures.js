import {
  composeActorMedallion,
  normalizeActorMedallionState,
} from "../../../runtime/src/render/actor-medallion-composer.js";

const MIN_TEXTURE_SIZE = 8;
const DEFAULT_TEXTURE_SIZE = 64;

function safeSegment(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function vitalSegment(vital = {}) {
  const current = Number.isFinite(Number(vital.current)) ? Number(vital.current) : 1;
  const max = Number.isFinite(Number(vital.max)) ? Number(vital.max) : 1;
  const fraction = Number.isFinite(Number(vital.fraction)) ? Number(vital.fraction) : 1;
  return `${current.toFixed(3)}-${max.toFixed(3)}-${fraction.toFixed(3)}`;
}

export function shouldComposeActorMedallion(resourceBundle) {
  return Number(resourceBundle?.schemaVersion || 0) >= 2;
}

export function normalizeActorMedallionTextureSize({ width, height, size } = {}) {
  const requested = Number(size);
  if (Number.isFinite(requested) && requested > 0) {
    return Math.max(MIN_TEXTURE_SIZE, Math.round(requested));
  }
  const displaySize = Math.max(Number(width) || 0, Number(height) || 0);
  return Math.max(MIN_TEXTURE_SIZE, Math.round(displaySize || DEFAULT_TEXTURE_SIZE));
}

export function createActorMedallionTextureDescriptor({
  resourceBundle,
  actor,
  width,
  height,
  size,
} = {}) {
  if (!shouldComposeActorMedallion(resourceBundle)) return null;

  const textureSize = normalizeActorMedallionTextureSize({ width, height, size });
  const state = normalizeActorMedallionState(actor || {});
  const actorId = safeSegment(actor?.id || actor?.actorId || actor?.entityId);
  const stateKey = [
    safeSegment(state.role) || "delver",
    safeSegment(state.affinity) || "none",
    safeSegment(state.expression) || "emit",
    safeSegment(state.motivation) || "none",
    vitalSegment(state.vitals?.durability),
    vitalSegment(state.vitals?.health),
    vitalSegment(state.vitals?.stamina),
    vitalSegment(state.vitals?.mana),
  ].join(":");
  const key = actorId
    ? `ak-medallion:${textureSize}:${actorId}`
    : `ak-medallion:${textureSize}:${stateKey}`;

  return {
    key,
    size: textureSize,
    state,
    fingerprint: stateKey,
    pixels: composeActorMedallion({ actor, state, size: textureSize }),
  };
}
