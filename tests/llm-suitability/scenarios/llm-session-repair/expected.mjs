import assert from "node:assert/strict";
import { test } from "vitest";

import {
  extractJsonObject,
  runRepairableJsonSession,
} from "./source.js";

test("extractJsonObject accepts raw and fenced JSON", () => {
  assert.equal(extractJsonObject('{"ok":true}'), '{"ok":true}');
  assert.equal(extractJsonObject('prefix ```json\n{"ok":true}\n``` suffix'), '{"ok":true}');
});

test("runRepairableJsonSession returns valid first response without repair", async () => {
  const calls = [];
  const adapter = {
    async generate(request) {
      calls.push(request);
      return { response: '{"name":"ember","count":2}' };
    },
  };
  const result = await runRepairableJsonSession({
    adapter,
    model: "fixture",
    prompt: "make json",
    validate: (value) => ({ ok: typeof value.name === "string" && value.count > 0, errors: [] }),
    buildRepairPrompt: () => "repair",
    clock: () => "2026-04-26T00:00:00.000Z",
  });
  assert.equal(result.ok, true);
  assert.equal(result.repaired, false);
  assert.equal(calls.length, 1);
  assert.equal(result.capture.responseText, '{"name":"ember","count":2}');
});

test("runRepairableJsonSession issues repair prompt after validation failure", async () => {
  const prompts = [];
  const adapter = {
    async generate(request) {
      prompts.push(request.prompt);
      return prompts.length === 1
        ? { response: '{"name":"ember"}' }
        : { response: '{"name":"ember","count":2}' };
    },
  };
  const result = await runRepairableJsonSession({
    adapter,
    model: "fixture",
    prompt: "make json",
    validate: (value) => value.count > 0 ? { ok: true, errors: [] } : { ok: false, errors: ["count required"] },
    buildRepairPrompt: ({ errors }) => `repair: ${errors.join(",")}`,
    clock: () => "2026-04-26T00:00:00.000Z",
  });
  assert.equal(result.ok, true);
  assert.equal(result.repaired, true);
  assert.deepEqual(prompts, ["make json", "repair: count required"]);
  assert.equal(result.capture.repairedAt, "2026-04-26T00:00:00.000Z");
});
