export const enum ActionKind {
  IncrementCounter = 1,
  EmitLog = 2,
  EmitTelemetry = 3,
  RequestExternalFact = 4,
  RequestSolver = 5,
  FulfillRequest = 6,
  DeferRequest = 7,
  Move = 8,
}

export const enum ValidationError {
  None = 0,
  InvalidSeed = 1,
  InvalidActionKind = 2,
  InvalidActionValue = 3,
  MissingPendingRequest = 4,
  WrongActor = 5,
  TickMismatch = 6,
  WrongPosition = 7,
  NotAdjacent = 8,
  OutOfBounds = 9,
  BlockedByWall = 10,
  InvalidDirection = 11,
  MissingVital = 12,
  InvalidVital = 13,
  ActorOutOfBounds = 14,
  ActorSpawnMismatch = 15,
  ActorBlocked = 16,
  ActorCollision = 17,
  TooManyActors = 18,
}

export function validateSeed(seed: i32): i32 {
  return seed < 0 ? ValidationError.InvalidSeed : ValidationError.None;
}

export function validateAction(kind: i32, value: i32): i32 {
  switch (kind) {
    case ActionKind.IncrementCounter:
      return value != 1 ? ValidationError.InvalidActionValue : ValidationError.None;
    case ActionKind.EmitLog:
      return value < 0 || value > 3 ? ValidationError.InvalidActionValue : ValidationError.None;
    case ActionKind.EmitTelemetry:
      return value < 0 ? ValidationError.InvalidActionValue : ValidationError.None;
    case ActionKind.RequestExternalFact:
    case ActionKind.RequestSolver:
      return value < 0 || value > 255 ? ValidationError.InvalidActionValue : ValidationError.None;
    case ActionKind.FulfillRequest:
    case ActionKind.DeferRequest:
      return value <= 0 ? ValidationError.InvalidActionValue : ValidationError.None;
    case ActionKind.Move:
      return value < 0 ? ValidationError.InvalidActionValue : ValidationError.None;
    default:
      return ValidationError.InvalidActionKind;
  }
}
