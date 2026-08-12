import { createHash } from "node:crypto";

function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Content must contain only finite JSON numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new TypeError("Content must be JSON-serializable text or data");
}
const clone = (value) => JSON.parse(canonicalJson(value));
const serialize = (value) => typeof value === "string" ? `text:${value}` : `json:${canonicalJson(value)}`;

export function createAdaptiveWorkflowTestStore() {
  const states = new Map();
  const contents = new Map();
  const sideEffects = new Map();

  async function putContent(value) {
    const storedValue = clone(value);
    const serialized = serialize(storedValue);
    const digest = createHash("sha256").update(serialized).digest("hex");
    contents.set(digest, storedValue);
    return { algorithm: "sha256", digest, bytes: Buffer.byteLength(serialized), mediaType: typeof value === "string" ? "text/plain" : "application/json" };
  }
  async function getContent(ref) {
    const value = contents.get(ref?.digest);
    if (value === undefined) throw failure("replay_response_missing", "Recorded response content is missing");
    const serialized = serialize(value);
    const actual = createHash("sha256").update(serialized).digest("hex");
    if (ref.algorithm !== "sha256" || actual !== ref.digest) throw failure("replay_digest_mismatch", "Recorded response digest mismatch");
    if (ref.bytes !== undefined && ref.bytes !== Buffer.byteLength(serialized)) throw failure("replay_digest_mismatch", "Recorded response byte length mismatch");
    return clone(value);
  }
  return {
    async save(runId, state) { states.set(runId, clone(state)); return clone(state); },
    async load(runId) { return states.has(runId) ? clone(states.get(runId)) : undefined; },
    putContent,
    getContent,
    async reserveSideEffect({ idempotencyKey, payloadRef }) {
      if (typeof idempotencyKey !== "string" || !idempotencyKey.trim() || payloadRef?.algorithm !== "sha256" || !/^[a-f0-9]{64}$/.test(payloadRef.digest)) throw failure("invalid_idempotency_reservation", "Invalid idempotency reservation");
      const existing = sideEffects.get(idempotencyKey);
      if (existing) return clone(existing.payloadRef.algorithm === payloadRef.algorithm && existing.payloadRef.digest === payloadRef.digest ? { status: existing.status === "complete" ? "existing" : "pending", record: existing } : { status: "conflict", record: existing });
      const record = { schema: "agent-kernel/AdaptiveWorkflowIdempotencyRecord", schemaVersion: 1, idempotencyKey, payloadRef, status: "pending" };
      sideEffects.set(idempotencyKey, clone(record));
      return { status: "claimed", record: clone(record) };
    },
    async completeSideEffect({ idempotencyKey, receiptRef, receipt }) {
      const existing = sideEffects.get(idempotencyKey);
      if (!existing || existing.status !== "pending") throw failure("idempotency_not_pending", "Side effect reservation is not pending");
      await getContent(receiptRef);
      const record = { ...existing, status: "complete", receiptRef, receipt: clone(receipt) };
      sideEffects.set(idempotencyKey, clone(record));
      return clone(record);
    },
    async abortSideEffect(idempotencyKey) { if (sideEffects.get(idempotencyKey)?.status === "pending") sideEffects.delete(idempotencyKey); },
    tamperContent(ref, value) { contents.set(ref.digest, clone(value)); },
  };
}

function failure(code, message) {
  return Object.assign(new Error(message), { code, category: "persistence" });
}
