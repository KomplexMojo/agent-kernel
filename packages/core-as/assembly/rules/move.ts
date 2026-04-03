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
  applyStaticTrapDamageAt(action.toX, action.toY);
  return ValidationError.None;
}

export function reachedExitAfterMove(): bool {
  return isActorAtExit();
}
