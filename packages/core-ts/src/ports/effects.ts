export const EffectKind = {
  Log: 1,
  InitInvalid: 2,
  ActionRejected: 3,
  LimitReached: 4,
  LimitViolated: 5,
  NeedExternalFact: 6,
  Telemetry: 7,
  SolverRequest: 8,
  EffectFulfilled: 9,
  EffectDeferred: 10,
  ActorMoved: 11,
  ConfigInvalid: 12,
  DurabilityChanged: 13,
  ActorBlocked: 14,
} as const;

const MAX_EFFECTS = 32;

export function createEffectsPort() {
  let effectCount = 0;
  const effectKinds = new Int32Array(MAX_EFFECTS);
  const effectValues = new Int32Array(MAX_EFFECTS);
  const effectActorId = new Int32Array(MAX_EFFECTS);
  const effectX = new Int32Array(MAX_EFFECTS);
  const effectY = new Int32Array(MAX_EFFECTS);
  const effectReason = new Int32Array(MAX_EFFECTS);
  const effectDelta = new Int32Array(MAX_EFFECTS);

  function pushEffect(kind: number, value: number): void {
    if (effectCount >= MAX_EFFECTS) {
      return;
    }
    effectKinds[effectCount] = kind;
    effectValues[effectCount] = value;
    effectActorId[effectCount] = 0;
    effectX[effectCount] = 0;
    effectY[effectCount] = 0;
    effectReason[effectCount] = 0;
    effectDelta[effectCount] = 0;
    effectCount += 1;
  }

  function pushActorMoved(actorId: number, x: number, y: number): void {
    if (effectCount >= MAX_EFFECTS) {
      return;
    }
    const index = effectCount;
    effectKinds[index] = EffectKind.ActorMoved;
    effectValues[index] = 0;
    effectActorId[index] = actorId;
    effectX[index] = x;
    effectY[index] = y;
    effectReason[index] = 0;
    effectDelta[index] = 0;
    effectCount += 1;
  }

  function pushActorBlocked(
    actorId: number,
    x: number,
    y: number,
    reason: number,
  ): void {
    if (effectCount >= MAX_EFFECTS) {
      return;
    }
    const index = effectCount;
    effectKinds[index] = EffectKind.ActorBlocked;
    effectValues[index] = 0;
    effectActorId[index] = actorId;
    effectX[index] = x;
    effectY[index] = y;
    effectReason[index] = reason;
    effectDelta[index] = 0;
    effectCount += 1;
  }

  function pushDurabilityChanged(actorId: number, delta: number): void {
    if (effectCount >= MAX_EFFECTS) {
      return;
    }
    const index = effectCount;
    effectKinds[index] = EffectKind.DurabilityChanged;
    effectValues[index] = 0;
    effectActorId[index] = actorId;
    effectX[index] = 0;
    effectY[index] = 0;
    effectReason[index] = 0;
    effectDelta[index] = delta;
    effectCount += 1;
  }

  function getEffectCount(): number {
    return effectCount;
  }

  function getEffectKind(index: number): number {
    if (index < 0 || index >= effectCount) {
      return 0;
    }
    return effectKinds[index];
  }

  function getEffectValue(index: number): number {
    if (index < 0 || index >= effectCount) {
      return 0;
    }
    return effectValues[index];
  }

  function getEffectActorId(index: number): number {
    if (index < 0 || index >= effectCount) {
      return 0;
    }
    return effectActorId[index];
  }

  function getEffectX(index: number): number {
    if (index < 0 || index >= effectCount) {
      return 0;
    }
    return effectX[index];
  }

  function getEffectY(index: number): number {
    if (index < 0 || index >= effectCount) {
      return 0;
    }
    return effectY[index];
  }

  function getEffectReason(index: number): number {
    if (index < 0 || index >= effectCount) {
      return 0;
    }
    return effectReason[index];
  }

  function getEffectDelta(index: number): number {
    if (index < 0 || index >= effectCount) {
      return 0;
    }
    return effectDelta[index];
  }

  function clearEffects(): void {
    effectCount = 0;
  }

  return {
    pushEffect,
    pushActorMoved,
    pushActorBlocked,
    pushDurabilityChanged,
    getEffectCount,
    getEffectKind,
    getEffectValue,
    getEffectActorId,
    getEffectX,
    getEffectY,
    getEffectReason,
    getEffectDelta,
    clearEffects,
  };
}

export const EffectsConstants = {
  MAX_EFFECTS,
} as const;
