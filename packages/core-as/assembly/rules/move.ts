import {
  Direction,
  VitalKind,
  advanceTick,
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
  setActorPosition,
  setActorVital,
  withinBounds,
} from "../state/world";
import { ValidationError } from "../validate/inputs";

const STATIC_TRAP_EMIT_EXPRESSION: i32 = 3;
const STACK_ONE_EMIT_POWER: i32 = 10;
const INVALID_TRAP_TARGET_VITAL: i32 = -1;
const TRAP_TARGET_VITAL_BY_AFFINITY: i32[] = [
  INVALID_TRAP_TARGET_VITAL,
  VitalKind.Health,
  VitalKind.Health,
  VitalKind.Stamina,
  VitalKind.Stamina,
  VitalKind.Health,
  VitalKind.Health,
  VitalKind.Durability,
  VitalKind.Durability,
  VitalKind.Mana,
  VitalKind.Mana,
];

function resolveTrapTargetVital(affinityKind: i32): i32 {
  if (affinityKind < 0 || affinityKind >= TRAP_TARGET_VITAL_BY_AFFINITY.length) {
    return INVALID_TRAP_TARGET_VITAL;
  }
  return unchecked(TRAP_TARGET_VITAL_BY_AFFINITY[affinityKind]);
}

function computeTrapDamage(stacks: i32, manaReserve: i32): i32 {
  if (stacks <= 0 || manaReserve <= 0) {
    return 0;
  }
  const scaled = (STACK_ONE_EMIT_POWER * stacks * manaReserve) / 100;
  return scaled > 0 ? scaled : 1;
}

function applyStaticTrapDamageAt(x: i32, y: i32): void {
  const expression = getStaticTrapExpressionAt(x, y);
  if (expression != STATIC_TRAP_EMIT_EXPRESSION) {
    return;
  }
  const affinityKind = getStaticTrapAffinityAt(x, y);
  const targetVital = resolveTrapTargetVital(affinityKind);
  if (targetVital < 0) {
    return;
  }
  const stacks = getStaticTrapStacksAt(x, y);
  const manaReserve = getStaticTrapManaReserveAt(x, y);
  const damage = computeTrapDamage(stacks, manaReserve);
  if (damage <= 0) {
    return;
  }
  const current = getActorVitalCurrent(targetVital);
  const max = getActorVitalMax(targetVital);
  const regen = getActorVitalRegen(targetVital);
  const next = current > damage ? current - damage : 0;
  setActorVital(targetVital, next, max, regen);
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
  } else if (action.direction == Direction.NorthEast) {
    dx = 1;
    dy = -1;
  } else if (action.direction == Direction.East) {
    dx = 1;
  } else if (action.direction == Direction.SouthEast) {
    dx = 1;
    dy = 1;
  } else if (action.direction == Direction.South) {
    dy = 1;
  } else if (action.direction == Direction.SouthWest) {
    dx = -1;
    dy = 1;
  } else if (action.direction == Direction.West) {
    dx = -1;
  } else if (action.direction == Direction.NorthWest) {
    dx = -1;
    dy = -1;
  } else {
    return false;
  }
  return action.fromX + dx == action.toX && action.fromY + dy == action.toY;
}

function validateMoveIdentityAndTiming(action: MoveAction): ValidationError {
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
  return ValidationError.None;
}

function validateMoveGeometryAndDestination(action: MoveAction): ValidationError {
  const dx = action.toX - action.fromX;
  const dy = action.toY - action.fromY;
  const absDx = abs(dx);
  const absDy = abs(dy);
  if ((absDx == 0 && absDy == 0) || absDx > 1 || absDy > 1) {
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
  return ValidationError.None;
}

function computeNextStaminaAfterRegen(_movementCost: i32): i32 {
  const staminaCurrent = getActorVitalCurrent(VitalKind.Stamina);
  const staminaMax = getActorVitalMax(VitalKind.Stamina);
  const staminaRegen = getActorVitalRegen(VitalKind.Stamina);
  let staminaNext = staminaCurrent + staminaRegen;
  if (staminaNext > staminaMax) {
    staminaNext = staminaMax;
  }
  return staminaNext;
}

function isDiagonalMove(action: MoveAction): bool {
  return action.fromX != action.toX && action.fromY != action.toY;
}

function computeMovementCost(action: MoveAction, cardinalCost: i32): i32 {
  if (!isDiagonalMove(action)) {
    return cardinalCost;
  }
  if (cardinalCost <= 0) {
    return cardinalCost;
  }
  const diagonalExtra = cardinalCost > 1 ? max(1, cardinalCost / 2) : 1;
  return cardinalCost + diagonalExtra;
}

function applyTileEntryEffects(x: i32, y: i32): void {
  applyStaticTrapDamageAt(x, y);
}

function commitMove(action: MoveAction, staminaRemaining: i32, staminaMax: i32, staminaRegen: i32): void {
  advanceTick();
  setActorVital(VitalKind.Stamina, staminaRemaining, staminaMax, staminaRegen);
  setActorPosition(action.toX, action.toY);
  applyTileEntryEffects(action.toX, action.toY);
}

export function applyMove(action: MoveAction): ValidationError {
  let validation = validateMoveIdentityAndTiming(action);
  if (validation != ValidationError.None) {
    return validation;
  }
  validation = validateMoveGeometryAndDestination(action);
  if (validation != ValidationError.None) {
    return validation;
  }
  const cardinalCost = getActorMovementCost();
  if (cardinalCost < 0) {
    return ValidationError.InvalidCapability;
  }
  const movementCost = computeMovementCost(action, cardinalCost);
  const staminaNext = computeNextStaminaAfterRegen(movementCost);
  const staminaMax = getActorVitalMax(VitalKind.Stamina);
  const staminaRegen = getActorVitalRegen(VitalKind.Stamina);
  if (staminaNext < movementCost) {
    return ValidationError.InsufficientStamina;
  }
  const staminaRemaining = staminaNext - movementCost;
  commitMove(action, staminaRemaining, staminaMax, staminaRegen);
  return ValidationError.None;
}

export function reachedExitAfterMove(): bool {
  return isActorAtExit();
}
