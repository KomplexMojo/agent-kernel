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
}

const MAX_EFFECTS: i32 = 32;
let effectCount: i32 = 0;
let effectKinds = new StaticArray<i32>(MAX_EFFECTS);
let effectValues = new StaticArray<i32>(MAX_EFFECTS);

export function pushEffect(kind: i32, value: i32): void {
  if (effectCount >= MAX_EFFECTS) {
    return;
  }
  effectKinds[effectCount] = kind;
  effectValues[effectCount] = value;
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

export function clearEffects(): void {
  effectCount = 0;
}
