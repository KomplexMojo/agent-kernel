// #679: the Anthropic provider for the play-sim drivers. A fake fetch stands in for the API, so
// no key is needed and nothing leaves the machine; the played game replays with no model call.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { createAnthropicAdapter, redact, resolveProvider } from "../../scripts/testing/play-sim-anthropic.mjs";
import { buildArm } from "../../scripts/testing/play-sim.mjs";
import { createCliTransport, llmSeatPicker, replayPicker, runSeat } from "../../scripts/testing/play-sim-seat.mjs";
import { loadPlaytestScenarios } from "../../packages/adapters-cli/src/cli/playtest-scenarios.mjs";

const KEY = "sk-ant-test-secret-123";
const reply = (text) => ({ ok: true, status: 200, json: async () => ({ content: [{ type: "text", text }] }) });

test("generate posts the Messages API shape and returns the text", async () => {
  const seen = [];
  const fetchFn = async (url, init) => { seen.push({ url, init, body: JSON.parse(init.body) }); return reply('{"action":"wait"}'); };
  const adapter = createAnthropicAdapter({ apiKey: KEY, fetchFn });
  const out = await adapter.generate({ model: "claude-haiku-5-5", prompt: "pick", options: { temperature: 0.2 }, format: "json", think: false });
  expect(out).toEqual({ response: '{"action":"wait"}' });
  expect(seen[0].url).toBe("https://api.anthropic.com/v1/messages");
  expect(seen[0].init.headers["x-api-key"]).toBe(KEY);
  expect(seen[0].body).toMatchObject({ model: "claude-haiku-5-5", temperature: 0.2, messages: [{ role: "user", content: "pick" }] });
});

test("a failed request never carries the key in its error", async () => {
  const leaky = async () => ({ ok: false, status: 401, json: async () => ({ error: { message: `bad key ${KEY}` } }) });
  await expect(createAnthropicAdapter({ apiKey: KEY, fetchFn: leaky }).generate({ model: "m", prompt: "p" })).rejects.toThrow(/401/);
  const thrown = await createAnthropicAdapter({ apiKey: KEY, fetchFn: leaky }).generate({ model: "m", prompt: "p" }).catch((error) => error.message);
  expect(thrown).not.toContain(KEY);
  const network = async () => { throw new Error(`socket closed for ${KEY}`); };
  const message = await createAnthropicAdapter({ apiKey: KEY, fetchFn: network }).generate({ model: "m", prompt: "p" }).catch((error) => error.message);
  expect(message).not.toContain(KEY);
  expect(redact(`x ${KEY} y`, KEY)).toBe("x [redacted] y");
});

test("the provider flag: ollama by default, anthropic needs the key, anything else is refused", () => {
  expect(resolveProvider(undefined, {})).toEqual({ provider: "ollama" });
  expect(() => resolveProvider("anthropic", {})).toThrow(/ANTHROPIC_API_KEY/);
  expect(resolveProvider("anthropic", { ANTHROPIC_API_KEY: KEY })).toEqual({ provider: "anthropic", apiKey: KEY });
  expect(() => resolveProvider("gpt", {})).toThrow(/unknown --provider/);
  expect(() => createAnthropicAdapter({})).toThrow(/ANTHROPIC_API_KEY/);
});

test("a game played by a recorded fake provider replays with no model call", async () => {
  const catalog = loadPlaytestScenarios();
  const scenario = catalog.scenarios.find((entry) => entry.id === "first-look") ?? catalog.scenarios[0];
  const work = mkdtempSync(join(tmpdir(), "anthropic-seat-"));
  const arm = buildArm(scenario, 0, { arm: "baseline", budgetTokens: scenario.budgetTokens }, work, catalog.createdAt);
  expect(arm.ok, arm.error).toBe(true);
  let calls = 0;
  const fetchFn = async () => { calls += 1; return reply(JSON.stringify({ action: "wait" })); };
  const picker = llmSeatPicker({ adapter: createAnthropicAdapter({ apiKey: KEY, fetchFn }), model: "claude-haiku-5-5" });
  const live = createCliTransport();
  const again = createCliTransport();
  try {
    const first = await runSeat({ transport: live, levelDir: arm.dir, picker, maxTurns: 4 });
    expect(calls).toBe(4);
    const replayed = await runSeat({ transport: again, levelDir: arm.dir, picker: replayPicker(first.transcript), maxTurns: 4 });
    expect(calls).toBe(4);
    expect(replayed.transcript).toEqual(first.transcript);
    expect(replayed.finalVitals).toEqual(first.finalVitals);
    expect(JSON.stringify(first)).not.toContain(KEY);
  } finally {
    live.cleanup();
    again.cleanup();
    rmSync(work, { recursive: true, force: true });
  }
}, 120000);

// ## TODO: Test Permutations
// - a 429 or 5xx response surfaces its status without the key
// - --provider anthropic with --driver t1-contact and --build-source llm
