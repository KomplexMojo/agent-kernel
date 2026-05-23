import { VitalKind } from "../state/vitals.ts";
import { ValidationError } from "../validate/inputs.ts";

export const Direction = {
  North: 0,
  NorthEast: 1,
  East: 2,
  SouthEast: 3,
  South: 4,
  SouthWest: 5,
  West: 6,
  NorthWest: 7,
} as const;

export const ResourceMode = {
  Consumable: 0,
  Level: 1,
  Permanent: 2,
} as const;

const STATIC_TRAP_EMIT_EXPRESSION = 3;
const STACK_ONE_EMIT_POWER = 10;
const INVALID_TRAP_TARGET_VITAL = -1;
const TRAP_TARGET_VITAL_BY_AFFINITY = Object.freeze([
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
]);

export interface MoveAction {
  actorId: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  direction: number;
  tick: number;
}

export interface MoveWorld {
  advanceTick(): void;
  getActorId(): number;
  getActorMovementCost(): number;
  getActorVitalCurrent(vitalKind: number): number;
  getActorVitalMax(vitalKind: number): number;
  getActorVitalRegen(vitalKind: number): number;
  getStaticTrapAffinityAt(x: number, y: number): number;
  getStaticTrapExpressionAt(x: number, y: number): number;
  getStaticTrapManaReserveAt(x: number, y: number): number;
  getStaticTrapStacksAt(x: number, y: number): number;
  getActorX(): number;
  getActorY(): number;
  getCurrentTick(): number;
  hasActor(): boolean;
  hasResourceAt(x: number, y: number): number;
  getResourceVitalKindAt(x: number, y: number): number;
  getResourceDeltaAt(x: number, y: number): number;
  getResourceModeAt(x: number, y: number): number;
  removeResourceAt(x: number, y: number): void;
  isActorAtExit(): boolean;
  isMotivatedOccupied(x: number, y: number): boolean;
  isWalkablePosition(x: number, y: number): boolean;
  setActorPosition(x: number, y: number): void;
  setActorVital(vitalKind: number, current: number, max: number, regen: number): void;
  withinBounds(x: number, y: number): boolean;
}

function createBlankMove(): MoveAction {
  return {
    actorId: 0,
    fromX: 0,
    fromY: 0,
    toX: 0,
    toY: 0,
    direction: 0,
    tick: 0,
  };
}

function resolveTrapTargetVital(affinityKind: number): number {
  if (
    affinityKind < 0 ||
    affinityKind >= TRAP_TARGET_VITAL_BY_AFFINITY.length
  ) {
    return INVALID_TRAP_TARGET_VITAL;
  }
  return TRAP_TARGET_VITAL_BY_AFFINITY[affinityKind];
}

export function computeTrapDamage(stacks: number, manaReserve: number): number {
  if (stacks <= 0 || manaReserve <= 0) return 0;
  const scaled = (STACK_ONE_EMIT_POWER * stacks * manaReserve) / 100;
  return scaled > 0 ? scaled : 1;
}

export function createMoveRules(world: MoveWorld) {
  let pendingMove = createBlankMove();

  function applyStaticTrapDamageAt(x: number, y: number): void {
    const expression = world.getStaticTrapExpressionAt(x, y);
    if (expression !== STATIC_TRAP_EMIT_EXPRESSION) return;

    const affinityKind = world.getStaticTrapAffinityAt(x, y);
    const targetVital = resolveTrapTargetVital(affinityKind);
    if (targetVital < 0) return;

    const stacks = world.getStaticTrapStacksAt(x, y);
    const manaReserve = world.getStaticTrapManaReserveAt(x, y);
    const damage = computeTrapDamage(stacks, manaReserve);
    if (damage <= 0) return;

    const current = world.getActorVitalCurrent(targetVital);
    const max = world.getActorVitalMax(targetVital);
    const regen = world.getActorVitalRegen(targetVital);
    const next = current > damage ? current - damage : 0;
    world.setActorVital(targetVital, next, max, regen);
  }

  function setMoveAction(
    actorId: number,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    direction: number,
    tick: number,
  ): void {
    pendingMove = { actorId, fromX, fromY, toX, toY, direction, tick };
  }

  function decodeMove(_value: number): MoveAction {
    return { ...pendingMove };
  }

  function validateDirection(action: MoveAction): boolean {
    let dx = 0;
    let dy = 0;
    if (action.direction === Direction.North) {
      dy = -1;
    } else if (action.direction === Direction.NorthEast) {
      dx = 1;
      dy = -1;
    } else if (action.direction === Direction.East) {
      dx = 1;
    } else if (action.direction === Direction.SouthEast) {
      dx = 1;
      dy = 1;
    } else if (action.direction === Direction.South) {
      dy = 1;
    } else if (action.direction === Direction.SouthWest) {
      dx = -1;
      dy = 1;
    } else if (action.direction === Direction.West) {
      dx = -1;
    } else if (action.direction === Direction.NorthWest) {
      dx = -1;
      dy = -1;
    } else {
      return false;
    }
    return action.fromX + dx === action.toX && action.fromY + dy === action.toY;
  }

  function validateMoveIdentityAndTiming(action: MoveAction): number {
    if (!world.hasActor()) return ValidationError.WrongActor;
    if (action.actorId !== world.getActorId()) return ValidationError.WrongActor;
    if (action.tick !== world.getCurrentTick() + 1) return ValidationError.TickMismatch;
    if (action.fromX !== world.getActorX() || action.fromY !== world.getActorY()) {
      return ValidationError.WrongPosition;
    }
    return ValidationError.None;
  }

  function validateMoveGeometryAndDestination(action: MoveAction): number {
    const dx = action.toX - action.fromX;
    const dy = action.toY - action.fromY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    if ((absDx === 0 && absDy === 0) || absDx > 1 || absDy > 1) {
      return ValidationError.NotAdjacent;
    }
    if (!validateDirection(action)) return ValidationError.InvalidDirection;
    if (!world.withinBounds(action.toX, action.toY)) return ValidationError.OutOfBounds;
    if (!world.isWalkablePosition(action.toX, action.toY)) {
      return ValidationError.BlockedByWall;
    }
    if (world.isMotivatedOccupied(action.toX, action.toY)) {
      return ValidationError.ActorCollision;
    }
    return ValidationError.None;
  }

  function computeNextStaminaAfterRegen(_movementCost: number): number {
    const staminaCurrent = world.getActorVitalCurrent(VitalKind.Stamina);
    const staminaMax = world.getActorVitalMax(VitalKind.Stamina);
    const staminaRegen = world.getActorVitalRegen(VitalKind.Stamina);
    return Math.min(staminaCurrent + staminaRegen, staminaMax);
  }

  function isDiagonalMove(action: MoveAction): boolean {
    return action.fromX !== action.toX && action.fromY !== action.toY;
  }

  function computeMovementCost(action: MoveAction, cardinalCost: number): number {
    if (!isDiagonalMove(action)) return cardinalCost;
    if (cardinalCost <= 0) return cardinalCost;
    const diagonalExtra = cardinalCost > 1 ? Math.max(1, Math.trunc(cardinalCost / 2)) : 1;
    return cardinalCost + diagonalExtra;
  }

  function applyResourceCaptureAt(x: number, y: number): void {
    if (world.hasResourceAt(x, y) === 0) return;
    const vitalKind = world.getResourceVitalKindAt(x, y);
    const delta = world.getResourceDeltaAt(x, y);
    const mode = world.getResourceModeAt(x, y);
    world.removeResourceAt(x, y);
    if (vitalKind < 0) return;

    const current = world.getActorVitalCurrent(vitalKind);
    const max = world.getActorVitalMax(vitalKind);
    const regen = world.getActorVitalRegen(vitalKind);
    if (mode === ResourceMode.Consumable) {
      const nextCurrent = Math.min(Math.max(current + delta, 0), max);
      world.setActorVital(vitalKind, nextCurrent, max, regen);
    } else {
      const nextMax = Math.max(max + delta, 0);
      const nextCurrent = Math.max(current + delta, 0);
      world.setActorVital(vitalKind, nextCurrent, nextMax, regen);
    }
  }

  function applyTileEntryEffects(x: number, y: number): void {
    applyStaticTrapDamageAt(x, y);
    applyResourceCaptureAt(x, y);
  }

  function commitMove(
    action: MoveAction,
    staminaRemaining: number,
    staminaMax: number,
    staminaRegen: number,
  ): void {
    world.advanceTick();
    world.setActorVital(VitalKind.Stamina, staminaRemaining, staminaMax, staminaRegen);
    world.setActorPosition(action.toX, action.toY);
    applyTileEntryEffects(action.toX, action.toY);
  }

  function applyMove(action: MoveAction): number {
    let validation = validateMoveIdentityAndTiming(action);
    if (validation !== ValidationError.None) return validation;
    validation = validateMoveGeometryAndDestination(action);
    if (validation !== ValidationError.None) return validation;

    const cardinalCost = world.getActorMovementCost();
    if (cardinalCost < 0) return ValidationError.InvalidCapability;

    const movementCost = computeMovementCost(action, cardinalCost);
    const staminaNext = computeNextStaminaAfterRegen(movementCost);
    const staminaMax = world.getActorVitalMax(VitalKind.Stamina);
    const staminaRegen = world.getActorVitalRegen(VitalKind.Stamina);
    if (staminaNext < movementCost) return ValidationError.InsufficientStamina;

    commitMove(action, staminaNext - movementCost, staminaMax, staminaRegen);
    return ValidationError.None;
  }

  function reachedExitAfterMove(): boolean {
    return world.isActorAtExit();
  }

  return {
    setMoveAction,
    decodeMove,
    validateDirection,
    validateMoveIdentityAndTiming,
    validateMoveGeometryAndDestination,
    computeNextStaminaAfterRegen,
    computeMovementCost,
    applyResourceCaptureAt,
    applyTileEntryEffects,
    applyMove,
    reachedExitAfterMove,
  };
}
