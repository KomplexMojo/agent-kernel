import {
  Direction,
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
  setActorPosition(action.toX, action.toY);
  setCurrentTick(action.tick);
  return ValidationError.None;
}

export function reachedExitAfterMove(): bool {
  return isActorAtExit();
}
