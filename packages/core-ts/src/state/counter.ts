export function createCounterState() {
  let counter = 0;

  function resetCounter(seed: number): void {
    counter = seed;
  }

  function incrementCounter(delta = 1): number {
    counter += delta;
    return counter;
  }

  function getCounterValue(): number {
    return counter;
  }

  return {
    resetCounter,
    incrementCounter,
    getCounterValue,
  };
}
