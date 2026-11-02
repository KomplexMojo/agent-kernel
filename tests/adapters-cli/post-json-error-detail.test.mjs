// A failed model request names the server's reason, not just the status (a failed model load and a
// bad request are both a 500 from Ollama; only the body tells them apart).
import { expect, test } from "vitest";
import { postJson } from "../../packages/adapters-cli/src/adapters/model/shared.js";

test("postJson puts the response body in the error message", async () => {
  const fetchFn = async () => ({ ok: false, status: 500, statusText: "Internal Server Error", text: async () => '{"error":"model failed to load"}' });
  await expect(postJson(fetchFn, "http://x/api/generate", {}, {}, { errorPrefix: "LLM request failed" }))
    .rejects.toMatchObject({ status: 500, message: 'LLM request failed: 500 Internal Server Error - {"error":"model failed to load"}' });
});

test("postJson keeps the plain status line when the body is missing", async () => {
  const plain = async () => ({ ok: false, status: 500, statusText: "Internal Server Error" });
  await expect(postJson(plain, "http://x", {}, {}, { errorPrefix: "LLM request failed" })).rejects.toMatchObject({ message: "LLM request failed: 500 Internal Server Error" });
});
