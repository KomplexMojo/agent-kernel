let counter: i32 = 0;

export function resetCounter(seed: i32): void {
  counter = seed;
}

export function incrementCounter(delta: i32 = 1): i32 {
  counter += delta;
  return counter;
}

export function getCounterValue(): i32 {
  return counter;
}
