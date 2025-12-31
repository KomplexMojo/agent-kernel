let requestSequence: i32 = 0;
let pendingRequest: i32 = 0;

export function resetEffectState(): void {
  requestSequence = 0;
  pendingRequest = 0;
}

export function nextRequestSequence(): i32 {
  requestSequence += 1;
  return requestSequence;
}

export function setPendingRequest(seq: i32): void {
  pendingRequest = seq;
}

export function getPendingRequest(): i32 {
  return pendingRequest;
}

export function clearPendingRequest(): void {
  pendingRequest = 0;
}
