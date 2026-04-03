export const enum EffectKind {
  Log = 1,
  InitInvalid = 2,
  ActionRejected = 3,
  LimitReached = 4,
  LimitViolated = 5,
  NeedExternalFact = 6,
  Telemetry = 7,
  SolverRequest = 8,
  EffectFulfilled = 9,
  EffectDeferred = 10,
  ActorMoved = 11,
  ConfigInvalid = 12,
  DurabilityChanged = 13,
  ActorBlocked = 14,
}

const MAX_EFFECTS: i32 = 32;
let effectCount: i32 = 0;
let effectKinds = new StaticArray<i32>(MAX_EFFECTS);
let effectValues = new StaticArray<i32>(MAX_EFFECTS);
let effectActorId = new StaticArray<i32>(MAX_EFFECTS);
let effectX = new StaticArray<i32>(MAX_EFFECTS);
let effectY = new StaticArray<i32>(MAX_EFFECTS);
let effectReason = new StaticArray<i32>(MAX_EFFECTS);
let effectDelta = new StaticArray<i32>(MAX_EFFECTS);

export function pushEffect(kind: i32, value: i32): void {
  if (effectCount >= MAX_EFFECTS) {
    return;
  }
  effectKinds[effectCount] = kind;
  effectValues[effectCount] = value;
  unchecked(effectActorId[effectCount] = 0);
  unchecked(effectX[effectCount] = 0);
  unchecked(effectY[effectCount] = 0);
  unchecked(effectReason[effectCount] = 0);
  unchecked(effectDelta[effectCount] = 0);
  effectCount += 1;
}

export function pushActorMoved(actorId: i32, x: i32, y: i32): void {
  if (effectCount >= MAX_EFFECTS) {
    return;
  }
  const index = effectCount;
  effectKinds[index] = EffectKind.ActorMoved;
  effectValues[index] = 0;
  unchecked(effectActorId[index] = actorId);
  unchecked(effectX[index] = x);
  unchecked(effectY[index] = y);
  unchecked(effectReason[index] = 0);
  unchecked(effectDelta[index] = 0);
  effectCount += 1;
}

export function pushActorBlocked(actorId: i32, x: i32, y: i32, reason: i32): void {
  if (effectCount >= MAX_EFFECTS) {
    return;
  }
  const index = effectCount;
  effectKinds[index] = EffectKind.ActorBlocked;
  effectValues[index] = 0;
  unchecked(effectActorId[index] = actorId);
  unchecked(effectX[index] = x);
  unchecked(effectY[index] = y);
  unchecked(effectReason[index] = reason);
  unchecked(effectDelta[index] = 0);
  effectCount += 1;
}

export function pushDurabilityChanged(actorId: i32, delta: i32): void {
  if (effectCount >= MAX_EFFECTS) {
    return;
  }
  const index = effectCount;
  effectKinds[index] = EffectKind.DurabilityChanged;
  effectValues[index] = 0;
  unchecked(effectActorId[index] = actorId);
  unchecked(effectX[index] = 0);
  unchecked(effectY[index] = 0);
  unchecked(effectReason[index] = 0);
  unchecked(effectDelta[index] = delta);
  effectCount += 1;
}

export function getEffectCount(): i32 {
  return effectCount;
}

export function getEffectKind(index: i32): i32 {
  if (index < 0 || index >= effectCount) {
    return 0;
  }
  return unchecked(effectKinds[index]);
}

export function getEffectValue(index: i32): i32 {
  if (index < 0 || index >= effectCount) {
    return 0;
  }
  return unchecked(effectValues[index]);
}

export function getEffectActorId(index: i32): i32 {
  if (index < 0 || index >= effectCount) {
    return 0;
  }
  return unchecked(effectActorId[index]);
}

export function getEffectX(index: i32): i32 {
  if (index < 0 || index >= effectCount) {
    return 0;
  }
  return unchecked(effectX[index]);
}

export function getEffectY(index: i32): i32 {
  if (index < 0 || index >= effectCount) {
    return 0;
  }
  return unchecked(effectY[index]);
}

export function getEffectReason(index: i32): i32 {
  if (index < 0 || index >= effectCount) {
    return 0;
  }
  return unchecked(effectReason[index]);
}

export function getEffectDelta(index: i32): i32 {
  if (index < 0 || index >= effectCount) {
    return 0;
  }
  return unchecked(effectDelta[index]);
}

export function clearEffects(): void {
  effectCount = 0;
}
