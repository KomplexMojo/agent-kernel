import {
  Direction,
  VitalKind,
  advanceTick,
  clearAmbientOutcome,
  consumeStaticTrapManaReserveAt,
  getActorId,
  getActorMovementCost,
  getActorVitalCurrent,
  getActorVitalMax,
  getActorVitalRegen,
  getStaticTrapAffinityAt,
  getStaticTrapExpressionAt,
  getStaticTrapManaReserveAt,
  getStaticTrapStacksAt,
  getActorX,
  getActorY,
  getCurrentTick,
  hasActor,
  isActorAtExit,
  isMotivatedOccupied,
  isWalkablePosition,
  setAmbientOutcome,
  setActorPosition,
  setActorVital,
  withinBounds,
} from "../state/world";
import { ValidationError } from "../validate/inputs";

const STATIC_TRAP_EMIT_EXPRESSION: i32 = 3;
const STATIC_TRAP_DRAW_EXPRESSION: i32 = 4;
const STACK_ONE_EMIT_POWER: i32 = 10;
const AFFINITY_KIND_COUNT: i32 = 11;
const TRAP_MANA_DRAIN_PER_TICK: i32 = 1;
const AMBIENT_OUTCOME_CANCELLED: i32 = 1;
const AMBIENT_OUTCOME_EMIT: i32 = 2;
const AMBIENT_OUTCOME_DRAW: i32 = 3;

function resolveTrapTargetVital(affinityKind: i32): i32 {
  if (affinityKind == 1 || affinityKind == 2 || affinityKind == 5 || affinityKind == 6) {
    return VitalKind.Health;
  }
  if (affinityKind == 3 || affinityKind == 4) {
    return VitalKind.Stamina;
  }
  if (affinityKind == 9 || affinityKind == 10) {
    return VitalKind.Mana;
  }
  if (affinityKind == 7 || affinityKind == 8) {
    return VitalKind.Durability;
  }
  return -1;
}

function computeTrapPower(stacks: i32, manaReserve: i32): i32 {
  if (stacks <= 0 || manaReserve <= 0) {
    return 0;
  }
  const scaled = (STACK_ONE_EMIT_POWER * stacks * manaReserve) / 100;
  return scaled > 0 ? scaled : 1;
}

function oppositeAffinityKind(kind: i32): i32 {
  if (kind == 1) return 2;
  if (kind == 2) return 1;
  if (kind == 3) return 4;
  if (kind == 4) return 3;
  if (kind == 5) return 6;
  if (kind == 6) return 5;
  if (kind == 7) return 8;
  if (kind == 8) return 7;
  if (kind == 9) return 10;
  if (kind == 10) return 9;
  return 0;
}

function sampleAmbientTrapAt(x: i32, y: i32, emitPowerByAffinity: StaticArray<i32>, drawPowerByAffinity: StaticArray<i32>): void {
  if (!withinBounds(x, y)) {
    return;
  }
  const expression = getStaticTrapExpressionAt(x, y);
  if (expression != STATIC_TRAP_EMIT_EXPRESSION && expression != STATIC_TRAP_DRAW_EXPRESSION) {
    return;
  }
  const affinityKind = getStaticTrapAffinityAt(x, y);
  if (affinityKind <= 0 || affinityKind >= AFFINITY_KIND_COUNT) {
    return;
  }
  const manaReserve = getStaticTrapManaReserveAt(x, y);
  if (manaReserve <= 0) {
    return;
  }
  const stacks = getStaticTrapStacksAt(x, y);
  const power = computeTrapPower(stacks, manaReserve);
  if (power <= 0) {
    return;
  }
  if (expression == STATIC_TRAP_EMIT_EXPRESSION) {
    unchecked(emitPowerByAffinity[affinityKind] += power);
  } else {
    unchecked(drawPowerByAffinity[affinityKind] += power);
  }
  consumeStaticTrapManaReserveAt(x, y, TRAP_MANA_DRAIN_PER_TICK);
}

function cancelOpposingAffinityPower(powerByAffinity: StaticArray<i32>): void {
  for (let kind = 1; kind < AFFINITY_KIND_COUNT; kind += 1) {
    const opposite = oppositeAffinityKind(kind);
    if (opposite <= kind) {
      continue;
    }
    const left = unchecked(powerByAffinity[kind]);
    const right = unchecked(powerByAffinity[opposite]);
    if (left <= 0 || right <= 0) {
      continue;
    }
    const cancelled = left < right ? left : right;
    unchecked(powerByAffinity[kind] = left - cancelled);
    unchecked(powerByAffinity[opposite] = right - cancelled);
  }
}

function selectDominantAffinity(powerByAffinity: StaticArray<i32>): i32 {
  let dominantKind = 0;
  let dominantPower = 0;
  for (let kind = 1; kind < AFFINITY_KIND_COUNT; kind += 1) {
    const power = unchecked(powerByAffinity[kind]);
    if (power > dominantPower) {
      dominantPower = power;
      dominantKind = kind;
    }
  }
  return dominantKind;
}

function applyAmbientFieldAt(x: i32, y: i32): void {
  clearAmbientOutcome();
  const emitPowerByAffinity = new StaticArray<i32>(AFFINITY_KIND_COUNT);
  const drawPowerByAffinity = new StaticArray<i32>(AFFINITY_KIND_COUNT);

  sampleAmbientTrapAt(x, y, emitPowerByAffinity, drawPowerByAffinity);
  sampleAmbientTrapAt(x, y - 1, emitPowerByAffinity, drawPowerByAffinity);
  sampleAmbientTrapAt(x + 1, y, emitPowerByAffinity, drawPowerByAffinity);
  sampleAmbientTrapAt(x, y + 1, emitPowerByAffinity, drawPowerByAffinity);
  sampleAmbientTrapAt(x - 1, y, emitPowerByAffinity, drawPowerByAffinity);

  cancelOpposingAffinityPower(emitPowerByAffinity);
  cancelOpposingAffinityPower(drawPowerByAffinity);

  const emitKind = selectDominantAffinity(emitPowerByAffinity);
  const drawKind = selectDominantAffinity(drawPowerByAffinity);
  const emitPower = emitKind > 0 ? unchecked(emitPowerByAffinity[emitKind]) : 0;
  const drawPower = drawKind > 0 ? unchecked(drawPowerByAffinity[drawKind]) : 0;

  if (emitPower <= 0 && drawPower <= 0) {
    return;
  }
  if (emitPower > 0 && drawPower > 0 && emitPower == drawPower) {
    setAmbientOutcome(AMBIENT_OUTCOME_CANCELLED, 0, 0, 0, -1, 0);
    return;
  }

  let selectedExpression = STATIC_TRAP_EMIT_EXPRESSION;
  let selectedKind = emitKind;
  let selectedPower = emitPower;
  if (drawPower > emitPower) {
    selectedExpression = STATIC_TRAP_DRAW_EXPRESSION;
    selectedKind = drawKind;
    selectedPower = drawPower;
  }
  if (selectedKind <= 0 || selectedPower <= 0) {
    return;
  }

  let targetVital = resolveTrapTargetVital(selectedKind);
  if (selectedExpression == STATIC_TRAP_DRAW_EXPRESSION) {
    targetVital = VitalKind.Mana;
  }
  if (targetVital < 0) {
    return;
  }

  const current = getActorVitalCurrent(targetVital);
  const max = getActorVitalMax(targetVital);
  const regen = getActorVitalRegen(targetVital);
  let next = current;
  if (selectedExpression == STATIC_TRAP_EMIT_EXPRESSION) {
    next = current > selectedPower ? current - selectedPower : 0;
  } else {
    next = current + selectedPower;
    if (next > max) {
      next = max;
    }
  }
  const delta = next - current;
  setActorVital(targetVital, next, max, regen);
  setAmbientOutcome(
    selectedExpression == STATIC_TRAP_EMIT_EXPRESSION ? AMBIENT_OUTCOME_EMIT : AMBIENT_OUTCOME_DRAW,
    selectedKind,
    selectedExpression,
    selectedPower,
    targetVital,
    delta,
  );
}

export function evaluateAmbientAtActor(): void {
  if (!hasActor()) {
    clearAmbientOutcome();
    return;
  }
  applyAmbientFieldAt(getActorX(), getActorY());
}

export class MoveAction {
  actorId: i32 = 0;
  fromX: i32 = 0;
  fromY: i32 = 0;
  toX: i32 = 0;
  toY: i32 = 0;
  direction: i32 = 0;
  tick: i32 = 0;
}

let pendingMove = new MoveAction();

export function setMoveAction(
  actorId: i32,
  fromX: i32,
  fromY: i32,
  toX: i32,
  toY: i32,
  direction: i32,
  tick: i32,
): void {
  pendingMove.actorId = actorId;
  pendingMove.fromX = fromX;
  pendingMove.fromY = fromY;
  pendingMove.toX = toX;
  pendingMove.toY = toY;
  pendingMove.direction = direction;
  pendingMove.tick = tick;
}

export function decodeMove(_value: i32): MoveAction {
  return pendingMove;
}

function validateDirection(action: MoveAction): bool {
  let dx = 0;
  let dy = 0;
  if (action.direction == Direction.North) {
    dy = -1;
  } else if (action.direction == Direction.East) {
    dx = 1;
  } else if (action.direction == Direction.South) {
    dy = 1;
  } else if (action.direction == Direction.West) {
    dx = -1;
  }
  return action.fromX + dx == action.toX && action.fromY + dy == action.toY;
}

export function applyMove(action: MoveAction): ValidationError {
  if (!hasActor()) {
    return ValidationError.WrongActor;
  }
  if (action.actorId != getActorId()) {
    return ValidationError.WrongActor;
  }
  if (action.tick != getCurrentTick() + 1) {
    return ValidationError.TickMismatch;
  }
  if (action.fromX != getActorX() || action.fromY != getActorY()) {
    return ValidationError.WrongPosition;
  }
  const dx = action.toX - action.fromX;
  const dy = action.toY - action.fromY;
  const manhattan = abs(dx) + abs(dy);
  if (manhattan != 1) {
    return ValidationError.NotAdjacent;
  }
  if (!validateDirection(action)) {
    return ValidationError.InvalidDirection;
  }
  if (!withinBounds(action.toX, action.toY)) {
    return ValidationError.OutOfBounds;
  }
  if (!isWalkablePosition(action.toX, action.toY)) {
    return ValidationError.BlockedByWall;
  }
  if (isMotivatedOccupied(action.toX, action.toY)) {
    return ValidationError.ActorCollision;
  }
  const movementCost = getActorMovementCost();
  if (movementCost < 0) {
    return ValidationError.InvalidCapability;
  }
  const staminaCurrent = getActorVitalCurrent(VitalKind.Stamina);
  const staminaMax = getActorVitalMax(VitalKind.Stamina);
  const staminaRegen = getActorVitalRegen(VitalKind.Stamina);
  let staminaNext = staminaCurrent + staminaRegen;
  if (staminaNext > staminaMax) {
    staminaNext = staminaMax;
  }
  if (staminaNext < movementCost) {
    return ValidationError.InsufficientStamina;
  }
  advanceTick();
  const staminaRemaining = staminaNext - movementCost;
  setActorVital(VitalKind.Stamina, staminaRemaining, staminaMax, staminaRegen);
  setActorPosition(action.toX, action.toY);
  evaluateAmbientAtActor();
  return ValidationError.None;
}

export function reachedExitAfterMove(): bool {
  return isActorAtExit();
}
