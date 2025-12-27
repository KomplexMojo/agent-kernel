export const enum ValidationError {
  None = 0,
  InvalidSeed = 1,
  InvalidActionKind = 2,
  InvalidActionValue = 3,
}

export function validateSeed(seed: i32): i32 {
  return seed < 0 ? ValidationError.InvalidSeed : ValidationError.None;
}

export function validateAction(kind: i32, value: i32): i32 {
  if (kind != 1) {
    return ValidationError.InvalidActionKind;
  }
  if (value != 1) {
    return ValidationError.InvalidActionValue;
  }
  return ValidationError.None;
}
