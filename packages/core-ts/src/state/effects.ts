export function createEffectState() {
  let requestSequence = 0;
  let pendingRequest = 0;

  function resetEffectState(): void {
    requestSequence = 0;
    pendingRequest = 0;
  }

  function nextRequestSequence(): number {
    requestSequence += 1;
    return requestSequence;
  }

  function setPendingRequest(seq: number): void {
    pendingRequest = seq;
  }

  function getPendingRequest(): number {
    return pendingRequest;
  }

  function clearPendingRequest(): void {
    pendingRequest = 0;
  }

  return {
    resetEffectState,
    nextRequestSequence,
    setPendingRequest,
    getPendingRequest,
    clearPendingRequest,
  };
}
