export function createReplayEnvelope(result) {
  if (!result?.state?.runId || !Array.isArray(result.state.refs?.replayResponseRefs)) throw replayError("invalid_replay_source", "Replay source has no recorded responses");
  if (result.state.refs.replayResponseRefs.length === 0 || !result.state.refs.replayResponseRefs.every(isSha256Ref)) throw replayError("invalid_replay_source", "Replay source has invalid recorded response hashes");
  const meta = Object.freeze({ id: `${result.state.runId}:replay`, runId: result.state.runId, createdAt: result.state.updatedAt, producedBy: "adaptive-workflow" });
  return Object.freeze({
    schema: "agent-kernel/AdaptiveWorkflowReplay",
    schemaVersion: 1,
    meta,
    runId: result.state.runId,
    responseRefs: Object.freeze(result.state.refs.replayResponseRefs.map((ref) => Object.freeze(JSON.parse(JSON.stringify(ref))))),
  });
}

export function createReplayModelAdapter({ store, envelope } = {}) {
  if (envelope?.schema !== "agent-kernel/AdaptiveWorkflowReplay" || envelope.schemaVersion !== 1 || !envelope.runId || envelope.meta?.runId !== envelope.runId || !Array.isArray(envelope.responseRefs)) {
    throw replayError("invalid_replay_envelope", "Invalid adaptive workflow replay envelope");
  }
  if (envelope.responseRefs.length === 0 || !envelope.responseRefs.every(isSha256Ref)) throw replayError("replay_response_missing", "Recorded response hash is missing or invalid");
  if (!store?.getContent) throw replayError("durable_store_unavailable", "Replay requires a durable content store");
  const responseRefs = envelope.responseRefs.map((ref) => Object.freeze(JSON.parse(JSON.stringify(ref))));
  let cursor = 0;
  return Object.freeze({
    async generate() {
      const responseRef = responseRefs[cursor++];
      if (!responseRef?.digest) throw replayError("replay_response_missing", "Recorded response hash is missing");
      return store.getContent(responseRef);
    },
  });
}

function isSha256Ref(ref) {
  return ref?.algorithm === "sha256" && /^[a-f0-9]{64}$/.test(ref.digest) && (ref.bytes === undefined || (Number.isInteger(ref.bytes) && ref.bytes >= 0));
}

function replayError(code, message) {
  return Object.assign(new Error(message), { code, category: "persistence" });
}
