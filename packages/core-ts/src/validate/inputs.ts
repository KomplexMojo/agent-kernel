export const ActionKind = {
  IncrementCounter: 1,
  EmitLog: 2,
  EmitTelemetry: 3,
  RequestExternalFact: 4,
  RequestSolver: 5,
  FulfillRequest: 6,
  DeferRequest: 7,
  Move: 8,
} as const;

export const ValidationError = {
  None: 0,
  InvalidSeed: 1,
  InvalidActionKind: 2,
  InvalidActionValue: 3,
  MissingPendingRequest: 4,
  WrongActor: 5,
  TickMismatch: 6,
  WrongPosition: 7,
  NotAdjacent: 8,
  OutOfBounds: 9,
  BlockedByWall: 10,
  InvalidDirection: 11,
  MissingVital: 12,
  InvalidVital: 13,
  ActorOutOfBounds: 14,
  ActorSpawnMismatch: 15,
  ActorBlocked: 16,
  ActorCollision: 17,
  TooManyActors: 18,
  InsufficientStamina: 19,
  InvalidCapability: 20,
} as const;

/**
 * AM.1 — code -> name, DERIVED from ValidationError rather than hand-listed.
 *
 * Callers outside core-ts (the runtime records a rejection reason per action)
 * need a stable name for a rejection code. A second hand-written table would be
 * a parallel authority that silently drifts the moment a code is added here —
 * the exact failure mode F10 records for the affinity surface. Deriving the map
 * makes drift impossible.
 */
const VALIDATION_ERROR_NAME_BY_CODE: ReadonlyMap<number, string> = new Map(
  Object.entries(ValidationError).map(([name, code]) => [code as number, name]),
);

export function getValidationErrorName(code: number): string {
  return VALIDATION_ERROR_NAME_BY_CODE.get(code) ?? `Unknown(${code})`;
}

export function validateSeed(seed: number): number {
  return seed < 0 ? ValidationError.InvalidSeed : ValidationError.None;
}

export function validateAction(kind: number, value: number): number {
  switch (kind) {
    case ActionKind.IncrementCounter:
      return value !== 1
        ? ValidationError.InvalidActionValue
        : ValidationError.None;
    case ActionKind.EmitLog:
      return value < 0 || value > 3
        ? ValidationError.InvalidActionValue
        : ValidationError.None;
    case ActionKind.EmitTelemetry:
      return value < 0
        ? ValidationError.InvalidActionValue
        : ValidationError.None;
    case ActionKind.RequestExternalFact:
    case ActionKind.RequestSolver:
      return value < 0 || value > 255
        ? ValidationError.InvalidActionValue
        : ValidationError.None;
    case ActionKind.FulfillRequest:
    case ActionKind.DeferRequest:
      return value <= 0
        ? ValidationError.InvalidActionValue
        : ValidationError.None;
    case ActionKind.Move:
      return value < 0
        ? ValidationError.InvalidActionValue
        : ValidationError.None;
    default:
      return ValidationError.InvalidActionKind;
  }
}
