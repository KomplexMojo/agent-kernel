import { DEFAULT_LLM_BASE_URL } from "../../../../runtime/src/contracts/domain-constants.js";

function resolvePositiveInt(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = Math.floor(parsed);
  return normalized > 0 ? normalized : null;
}

async function fetchWithTimeout(fetchFn, url, init, timeoutMs) {
  const resolvedTimeoutMs = resolvePositiveInt(timeoutMs);
  if (!resolvedTimeoutMs) {
    return fetchFn(url, init);
  }
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const requestInit = controller ? { ...init, signal: controller.signal } : init;
  let timeoutHandle = null;
  let timedOut = false;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      if (controller) {
        try {
          controller.abort();
        } catch {
          // Ignore abort errors.
        }
      }
      reject(new Error(`LLM request timed out after ${resolvedTimeoutMs} ms`));
    }, resolvedTimeoutMs);
  });

  try {
    return await Promise.race([
      Promise.resolve().then(() => fetchFn(url, requestInit)),
      timeoutPromise,
    ]);
  } catch (error) {
    if (timedOut) {
      throw new Error(`LLM request timed out after ${resolvedTimeoutMs} ms`);
    }
    throw error;
  } finally {
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
    }
  }
}

export function createLlmAdapter({
  baseUrl = DEFAULT_LLM_BASE_URL,
  fetchFn = fetch,
  requestTimeoutMs = null,
} = {}) {
  if (!fetchFn) {
    throw new Error("LLM adapter requires a fetch implementation.");
  }

  async function generate({ model, prompt, options = {}, stream = false, format } = {}) {
    if (!model || !prompt) {
      throw new Error("LLM generate requires model and prompt.");
    }
    const payload = { model, prompt, options, stream };
    if (format) {
      payload.format = format;
    }
    const response = await fetchWithTimeout(fetchFn, `${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }, requestTimeoutMs);
    if (!response.ok) {
      throw new Error(`LLM request failed: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }

  return {
    generate,
  };
}
