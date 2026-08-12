import { validateAdaptiveWorkflowRunState } from "./contracts.ts";

export async function saveWorkflowState(store, state) {
  if (!store?.save) return state;
  const report = validateAdaptiveWorkflowRunState(state);
  if (!report.ok) throw persistenceError("invalid_durable_state", "Cannot persist an invalid adaptive workflow state");
  await store.save(state.runId, state);
  return state;
}

export async function recoverWorkflowState(store, runId) {
  if (!store?.load) throw persistenceError("durable_store_unavailable", "Durable workflow store cannot load state");
  const state = await store.load(runId);
  if (!state) throw persistenceError("durable_state_missing", `No durable state for ${runId}`);
  const report = validateAdaptiveWorkflowRunState(state);
  if (!report.ok || state.runId !== runId) throw persistenceError("invalid_durable_state", "Durable workflow state failed validation");
  return state;
}

export function createRecordingModelAdapter({ model, store, onRecorded }) {
  return {
    async generate(request) {
      const response = await model.generate(request);
      if (store?.putContent) {
        const responseRef = await store.putContent(response);
        await onRecorded?.(responseRef);
      }
      return response;
    },
  };
}

export async function executeDurableSideEffect({ store, idempotencyKey, payload, execute, isCancelled }) {
  if (!store?.putContent || !store?.reserveSideEffect || !store?.completeSideEffect) {
    return { duplicate: false, receipt: await execute() };
  }
  const payloadRef = await store.putContent(payload);
  const reservation = await store.reserveSideEffect({ idempotencyKey, payloadRef });
  if (reservation.status === "conflict") throw persistenceError("idempotency_conflict", "Idempotency conflict: key was used with a different payload");
  if (reservation.status === "pending") throw persistenceError("idempotency_pending", "Idempotent side effect is still pending");
  if (reservation.status === "existing") return { duplicate: true, ...reservation.record };
  try {
    if (await isCancelled?.()) {
      await store.abortSideEffect?.(idempotencyKey);
      throw cancellationError();
    }
  } catch (error) {
    if (error?.category !== "cancellation") await store.abortSideEffect?.(idempotencyKey);
    throw error;
  }
  let receipt;
  try {
    receipt = await execute();
  } catch (error) {
    if (error?.safeToRetry === true) await store.abortSideEffect?.(idempotencyKey);
    throw error;
  }
  const receiptRef = await store.putContent(receipt);
  const record = await store.completeSideEffect({ idempotencyKey, receiptRef, receipt });
  return { duplicate: false, ...record };
}

function persistenceError(code, message) {
  return Object.assign(new Error(message), { code, category: "persistence" });
}

function cancellationError() {
  return Object.assign(new Error("Side effect cancelled before execution"), { code: "cancelled", category: "cancellation" });
}
