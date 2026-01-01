import {
  Direction,
  encodePosition,
  getActorId,
  getActorX,
  getActorY,
  getCurrentTick,
  hasActor,
  isActorAtExit,
  isMotivatedOccupied,
  isWalkablePosition,
  setActorPosition,
  setCurrentTick,
  withinBounds,
} from "../state/world";
import { ValidationError } from "../validate/inputs";

const DIR_MASK: i32 = 0xf;
const COORD_MASK: i32 = 0xf;
const TICK_MASK: i32 = 0xff;
const ACTOR_MASK: i32 = 0xf;

const DIR_SHIFT: i32 = 0;
const FROM_X_SHIFT: i32 = 4;
const FROM_Y_SHIFT: i32 = 8;
const TO_X_SHIFT: i32 = 12;
const TO_Y_SHIFT: i32 = 16;
const TICK_SHIFT: i32 = 20;
const ACTOR_SHIFT: i32 = 28;

export class MoveAction {
  actorId: i32 = 0;
  fromX: i32 = 0;
  fromY: i32 = 0;
  toX: i32 = 0;
  toY: i32 = 0;
  direction: i32 = 0;
  tick: i32 = 0;
}

export function decodeMove(value: i32): MoveAction {
  const action = new MoveAction();
  action.direction = (value >> DIR_SHIFT) & DIR_MASK;
  action.fromX = (value >> FROM_X_SHIFT) & COORD_MASK;
  action.fromY = (value >> FROM_Y_SHIFT) & COORD_MASK;
  action.toX = (value >> TO_X_SHIFT) & COORD_MASK;
  action.toY = (value >> TO_Y_SHIFT) & COORD_MASK;
  action.tick = (value >> TICK_SHIFT) & TICK_MASK;
  action.actorId = (value >> ACTOR_SHIFT) & ACTOR_MASK;
  return action;
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
  setActorPosition(action.toX, action.toY);
  setCurrentTick(action.tick);
  return ValidationError.None;
}

export function encodeMovePositionValue(action: MoveAction): i32 {
  return encodePosition(action.toX, action.toY);
}

export function reachedExitAfterMove(): bool {
  return isActorAtExit();
}
