import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

export async function createFilesystemWorkflowStore({ root, create = true } = {}) {
  if (typeof root !== "string" || !root.trim()) throw failure("invalid_store_root", "Filesystem workflow store root is required");
  const requested = resolve(root);
  const existingRoot = await lstat(requested).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (existingRoot?.isSymbolicLink()) throw failure("unsafe_store_path", "Workflow store root must not be a symlink");
  if (create) await mkdir(requested, { recursive: true });
  const base = await realpath(requested).catch(() => { throw failure("store_missing", "Filesystem workflow store does not exist"); });
  const inside = (...parts) => {
    const path = resolve(base, ...parts);
    if (path !== base && !path.startsWith(`${base}${sep}`)) throw failure("path_escape", "Workflow store path escaped its root");
    return path;
  };
  async function directory(name) {
    const path = inside(name);
    await mkdir(path, { recursive: true });
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw failure("unsafe_store_path", "Workflow store directory must not be a symlink");
    return path;
  }
  async function atomicJson(path, value, claim = false) {
    const temp = `${path}.${randomUUID()}.tmp`;
    await writeFile(temp, `${JSON.stringify(value)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    try {
      if (claim) await link(temp, path);
      else await rename(temp, path);
      return true;
    } catch (error) {
      if (claim && error?.code === "EEXIST") return false;
      throw error;
    } finally {
      await rm(temp, { force: true });
    }
  }
  async function readJson(path, optional = false) {
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink()) throw failure("unsafe_store_path", "Workflow store record must not be a symlink");
      return JSON.parse(await readFile(path, "utf8"));
    }
    catch (error) {
      if (optional && error?.code === "ENOENT") return undefined;
      throw failure("corrupt_store_record", `Cannot read durable workflow record: ${error?.message || error}`);
    }
  }
  async function putContent(value) {
    const stored = clone(value); const serialized = serialize(stored);
    const digest = sha(serialized); const ref = { algorithm: "sha256", digest, bytes: Buffer.byteLength(serialized), mediaType: typeof value === "string" ? "text/plain" : "application/json" };
    const path = join(await directory("content"), `${digest}.json`);
    if (!(await readJson(path, true))) await atomicJson(path, { ref, value: stored });
    return clone(ref);
  }
  async function getContent(ref) {
    assertRef(ref); const record = await readJson(join(await directory("content"), `${ref.digest}.json`));
    const serialized = serialize(record.value); const digest = sha(serialized); const bytes = Buffer.byteLength(serialized);
    if (digest !== ref.digest || record.ref?.algorithm !== "sha256" || record.ref?.digest !== digest || record.ref?.bytes !== bytes || record.ref?.mediaType !== (typeof record.value === "string" ? "text/plain" : "application/json") || (ref.bytes !== undefined && ref.bytes !== bytes)) throw failure("replay_digest_mismatch", "Recorded response digest mismatch");
    return clone(record.value);
  }
  async function referenceContent(value) { const stored = clone(value); const serialized = serialize(stored); const ref = { algorithm: "sha256", digest: sha(serialized), bytes: Buffer.byteLength(serialized), mediaType: typeof value === "string" ? "text/plain" : "application/json" }; await getContent(ref); return clone(ref); }
  async function recordPath(key) {
    if (typeof key !== "string" || !key.trim()) throw failure("invalid_idempotency_reservation", "Idempotency key is required");
    return join(await directory("idempotency"), `${sha(`key:${key}`)}.json`);
  }
  async function reserveSideEffect({ idempotencyKey, payloadRef }) {
    assertRef(payloadRef); await getContent(payloadRef); const path = await recordPath(idempotencyKey); const existing = await readJson(path, true);
    if (existing) return reconcileReservation(existing, payloadRef, path);
    const record = { schema: "agent-kernel/AdaptiveWorkflowIdempotencyRecord", schemaVersion: 1, idempotencyKey, payloadRef: clone(payloadRef), status: "pending" };
    return await atomicJson(path, record, true) ? { status: "claimed", record: clone(record) } : reconcileReservation(await readJson(path), payloadRef, path);
  }
  async function reconcileReservation(existing, payloadRef, path) {
    const result = reservation(existing, payloadRef);
    if (result.status === "conflict" || existing.status !== "committing") return result;
    await getContent(existing.receiptRef);
    const complete = { ...existing, status: "complete" }; await atomicJson(path, complete);
    return { status: "existing", record: clone(complete) };
  }
  async function completeSideEffect({ idempotencyKey, receiptRef, receipt }) {
    const path = await recordPath(idempotencyKey); const existing = await readJson(path);
    if (existing.status !== "pending") throw failure("idempotency_not_pending", "Side effect reservation is not pending");
    await getContent(receiptRef);
    if (sha(serialize(clone(receipt))) !== receiptRef.digest) throw failure("receipt_digest_mismatch", "Execution receipt does not match its content reference");
    const committing = { ...existing, status: "committing", receiptRef: clone(receiptRef), receipt: clone(receipt) };
    await atomicJson(path, committing);
    const complete = { ...committing, status: "complete" };
    await atomicJson(path, complete); return clone(complete);
  }
  return Object.freeze({
    async save(runId, state) {
      if (typeof runId !== "string" || !runId.trim() || !state || state.runId !== runId) throw failure("invalid_durable_state", "Durable state runId mismatch");
      const path = inside("state.json"); const existing = await readJson(path, true);
      if (existing && existing.runId !== runId) throw failure("durable_state_conflict", "Output directory belongs to another workflow run");
      await atomicJson(path, clone(state)); return clone(state);
    },
    async load(runId) { const state = await readJson(inside("state.json"), true); return !state || (runId && state.runId !== runId) ? undefined : clone(state); },
    async writeArtifact(name, value) { await atomicJson(inside(artifactName(name)), clone(JSON.parse(JSON.stringify(value)))); },
    async readArtifact(name) { return clone(await readJson(inside(artifactName(name)))); },
    putContent, getContent, referenceContent, reserveSideEffect, completeSideEffect,
    async abortSideEffect(key) { const path = await recordPath(key); if ((await readJson(path, true))?.status === "pending") await rm(path, { force: true }); },
  });
}

function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") { if (!Number.isFinite(value)) throw new TypeError("Content must contain only finite JSON numbers"); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value))) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  throw new TypeError("Content must be JSON-serializable text or data");
}
const clone = (value) => JSON.parse(canonical(value));
const serialize = (value) => typeof value === "string" ? `text:${value}` : `json:${canonical(value)}`;
const sha = (value) => createHash("sha256").update(value).digest("hex");
function assertRef(ref) { if (ref?.algorithm !== "sha256" || !/^[a-f0-9]{64}$/.test(ref.digest) || (ref.bytes !== undefined && (!Number.isInteger(ref.bytes) || ref.bytes < 0))) throw failure("invalid_content_ref", "Invalid sha256 content reference"); }
function artifactName(name) { if (!/^[a-z0-9-]+\.json$/.test(name || "")) throw failure("unsafe_store_path", "Invalid workflow artifact name"); return name; }
function reservation(existing, ref) { return existing.payloadRef?.digest === ref.digest ? { status: existing.status === "complete" ? "existing" : "pending", record: clone(existing) } : { status: "conflict", record: clone(existing) }; }
function failure(code, message) { return Object.assign(new Error(message), { code, category: "persistence" }); }
