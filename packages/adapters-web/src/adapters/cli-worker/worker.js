import { executeBrowserCommand } from "./shared.js";

function serializeError(error) {
  if (!error) return { message: "Unknown worker error" };
  if (typeof error === "string") return { message: error };
  return {
    message: error.message || String(error),
    name: error.name || "Error",
    stack: error.stack || undefined,
  };
}

self.addEventListener("message", async (event) => {
  const payload = event?.data || {};
  const { id, action, env, payload: commandPayload } = payload;
  if (!id || !action) return;

  try {
    const result = await executeBrowserCommand(
      { action, payload: commandPayload },
      { env },
    );
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({ id, ok: false, error: serializeError(error) });
  }
});
