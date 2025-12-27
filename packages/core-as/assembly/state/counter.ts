let counter: i32 = 0;

export function resetCounter(seed: i32): void {
  counter = seed;
}

export function incrementCounter(): i32 {
  counter += 1;
  return counter;
}

export function getCounterValue(): i32 {
  return counter;
}
