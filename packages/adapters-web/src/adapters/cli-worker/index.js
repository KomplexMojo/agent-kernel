import { executeBrowserCommand } from "./shared.js";

function resolvePositiveInt(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = Math.floor(parsed);
  return normalized > 0 ? normalized : null;
}

function createDisposedError(message) {
  return new Error(message || "CLI worker adapter disposed");
}

function createInProcessCliWorkerAdapter({ fetchFn, env, nowIso } = {}) {
  return {
    build(payload, options) {
      return executeBrowserCommand({ action: "build", payload }, {
        fetchFn,
        env,
        nowIso,
        signal: options?.signal,
      });
    },
    solve(payload, options) {
      return executeBrowserCommand({ action: "solve", payload }, {
        fetchFn,
        env,
        nowIso,
        signal: options?.signal,
      });
    },
    buildSpecFromSummary(payload) {
      return executeBrowserCommand({ action: "build_spec_from_summary", payload }, { fetchFn, env, nowIso });
    },
    runPoolFlow(payload) {
      return executeBrowserCommand({ action: "pool_flow", payload }, { fetchFn, env, nowIso });
    },
    configurator(payload, options) {
      return executeBrowserCommand({ action: "configurator", payload }, {
        fetchFn,
        env,
        nowIso,
        signal: options?.signal,
      });
    },
    budget(payload, options) {
      return executeBrowserCommand({ action: "budget", payload }, {
        fetchFn,
        env,
        nowIso,
        signal: options?.signal,
      });
    },
    ipfs(payload, options) {
      return executeBrowserCommand({ action: "ipfs", payload }, {
        fetchFn,
        env,
        nowIso,
        signal: options?.signal,
      });
    },
    ipfsPublish(payload, options) {
      return executeBrowserCommand({ action: "ipfs_publish", payload }, {
        fetchFn,
        env,
        nowIso,
        signal: options?.signal,
      });
    },
    ipfsLoad(payload, options) {
      return executeBrowserCommand({ action: "ipfs_load", payload }, {
        fetchFn,
        env,
        nowIso,
        signal: options?.signal,
      });
    },
    blockchain(payload, options) {
      return executeBrowserCommand({ action: "blockchain", payload }, {
        fetchFn,
        env,
        nowIso,
        signal: options?.signal,
      });
    },
    blockchainMint(payload, options) {
      return executeBrowserCommand({ action: "blockchain_mint", payload }, {
        fetchFn,
        env,
        nowIso,
        signal: options?.signal,
      });
    },
    blockchainLoad(payload, options) {
      return executeBrowserCommand({ action: "blockchain_load", payload }, {
        fetchFn,
        env,
        nowIso,
        signal: options?.signal,
      });
    },
    llm(payload, options) {
      return executeBrowserCommand({ action: "llm", payload }, {
        fetchFn,
        env,
        nowIso,
        signal: options?.signal,
      });
    },
    llmPlan(payload, options) {
      return executeBrowserCommand({ action: "llm_plan", payload }, {
        fetchFn,
        env,
        nowIso,
        signal: options?.signal,
      });
    },
    run(payload, options) {
      return executeBrowserCommand({ action: "run", payload }, {
        fetchFn,
        env,
        nowIso,
        signal: options?.signal,
      });
    },
    replay(payload, options) {
      return executeBrowserCommand({ action: "replay", payload }, {
        fetchFn,
        env,
        nowIso,
        signal: options?.signal,
      });
    },
    inspect(payload, options) {
      return executeBrowserCommand({ action: "inspect", payload }, {
        fetchFn,
        env,
        nowIso,
        signal: options?.signal,
      });
    },
    manualMove(payload, options) {
      return executeBrowserCommand({ action: "manual_move", payload }, {
        fetchFn,
        env,
        nowIso,
        signal: options?.signal,
      });
    },
    normalizeBuildSpec({ spec } = {}) {
      return executeBrowserCommand({ action: "normalize_build_spec", payload: { spec } }, { fetchFn, env, nowIso });
    },
    dispose() {},
  };
}

export function createCliWorkerAdapter({
  workerFactory,
  workerUrl,
  requestTimeoutMs = 120000,
  forceInProcess = false,
  fetchFn,
  env = {},
  nowIso,
} = {}) {
  const timeoutMs = resolvePositiveInt(requestTimeoutMs);
  const shouldUseWorker = !forceInProcess && typeof Worker === "function";
  if (!shouldUseWorker) {
    return createInProcessCliWorkerAdapter({ fetchFn, env, nowIso });
  }

  let worker = null;
  try {
    worker = typeof workerFactory === "function"
      ? workerFactory()
      : new Worker(workerUrl || new URL("./worker.js", import.meta.url), { type: "module" });
  } catch (error) {
    return createInProcessCliWorkerAdapter({ fetchFn, env, nowIso });
  }

  const pending = new Map();
  let nextId = 1;

  function rejectPending(id, error) {
    if (!pending.has(id)) return;
    const entry = pending.get(id);
    pending.delete(id);
    if (entry?.timeoutHandle) clearTimeout(entry.timeoutHandle);
    if (entry?.abortHandler && entry?.signal?.removeEventListener) {
      entry.signal.removeEventListener("abort", entry.abortHandler);
    }
    entry.reject(error);
  }

  worker.addEventListener("message", (event) => {
    const payload = event?.data || {};
    const id = payload?.id;
    if (!id || !pending.has(id)) return;
    const entry = pending.get(id);
    pending.delete(id);
    if (entry?.timeoutHandle) clearTimeout(entry.timeoutHandle);
    if (entry?.abortHandler && entry?.signal?.removeEventListener) {
      entry.signal.removeEventListener("abort", entry.abortHandler);
    }
    if (payload.ok === false) {
      entry.reject(new Error(payload?.error?.message || "CLI worker request failed"));
      return;
    }
    entry.resolve(payload.result);
  });

  worker.addEventListener("error", (event) => {
    const error = new Error(event?.message || "CLI worker request failed");
    pending.forEach((_, id) => rejectPending(id, error));
  });

  function runWorkerRequest(action, payload, { signal } = {}) {
    const id = `cli_worker_${nextId}`;
    nextId += 1;
    return new Promise((resolve, reject) => {
      let timeoutHandle = null;
      if (timeoutMs) {
        timeoutHandle = setTimeout(() => {
          rejectPending(id, new Error(`CLI worker request timed out after ${timeoutMs} ms`));
        }, timeoutMs);
      }

      let abortHandler = null;
      if (signal?.addEventListener) {
        abortHandler = () => {
          rejectPending(id, new Error("CLI worker request aborted"));
        };
        if (signal.aborted) {
          abortHandler();
          return;
        }
        signal.addEventListener("abort", abortHandler, { once: true });
      }

      pending.set(id, {
        resolve,
        reject,
        timeoutHandle,
        abortHandler,
        signal,
      });

      worker.postMessage({
        id,
        action,
        payload,
        env,
      });
    });
  }

  return {
    build(payload, options) {
      return runWorkerRequest("build", payload, options);
    },
    solve(payload, options) {
      return runWorkerRequest("solve", payload, options);
    },
    buildSpecFromSummary(payload, options) {
      return runWorkerRequest("build_spec_from_summary", payload, options);
    },
    runPoolFlow(payload, options) {
      return runWorkerRequest("pool_flow", payload, options);
    },
    configurator(payload, options) {
      return runWorkerRequest("configurator", payload, options);
    },
    budget(payload, options) {
      return runWorkerRequest("budget", payload, options);
    },
    ipfs(payload, options) {
      return runWorkerRequest("ipfs", payload, options);
    },
    ipfsPublish(payload, options) {
      return runWorkerRequest("ipfs_publish", payload, options);
    },
    ipfsLoad(payload, options) {
      return runWorkerRequest("ipfs_load", payload, options);
    },
    blockchain(payload, options) {
      return runWorkerRequest("blockchain", payload, options);
    },
    blockchainMint(payload, options) {
      return runWorkerRequest("blockchain_mint", payload, options);
    },
    blockchainLoad(payload, options) {
      return runWorkerRequest("blockchain_load", payload, options);
    },
    llm(payload, options) {
      return runWorkerRequest("llm", payload, options);
    },
    llmPlan(payload, options) {
      return runWorkerRequest("llm_plan", payload, options);
    },
    run(payload, options) {
      return runWorkerRequest("run", payload, options);
    },
    replay(payload, options) {
      return runWorkerRequest("replay", payload, options);
    },
    inspect(payload, options) {
      return runWorkerRequest("inspect", payload, options);
    },
    manualMove(payload, options) {
      return runWorkerRequest("manual_move", payload, options);
    },
    normalizeBuildSpec({ spec } = {}, options) {
      return runWorkerRequest("normalize_build_spec", { spec }, options);
    },
    dispose() {
      pending.forEach((_, id) => rejectPending(id, createDisposedError()));
      pending.clear();
      worker.terminate();
    },
  };
}
