const assert = require("node:assert/strict");
const { resolve } = require("node:path");

const {
  getProfile, loadConfig, serviceEnvironment,
} = require("../../tools/remote-ollama-control/scripts/lib/config");
const { buildContentGenMatrix } = require("../../tools/remote-ollama-control/scripts/lib/benchmark");

const ROOT = resolve(__dirname, "../..", "tools/remote-ollama-control");

// A configurationId says ctx65536 and matrixHash encodes it. If the server is not actually serving
// that window, the identity asserts something that did not happen — and the result looks like a
// model-quality finding rather than a plumbing one.
//
// That is not hypothetical. The benchmark asked per request with `options: { num_ctx }` while
// posting to /v1/chat/completions, where Ollama's OpenAI-compatible shim discards `options`
// silently. Every load fell back to the VRAM-based default of 32768. On `primary` that default
// equals the configured value, so the bug was invisible on half the matrix; the three `dual`
// configurations ran at half their declared context for months.

test("every profile serves the context its own config declares", () => {
  const config = loadConfig(ROOT);
  for (const name of Object.keys(config.profiles)) {
    const profile = getProfile(config, name);
    const env = serviceEnvironment(profile);
    assert.equal(
      env.OLLAMA_CONTEXT_LENGTH, String(profile.defaultContext),
      `${name} declares defaultContext ${profile.defaultContext} but does not serve it; `
      + "Ollama would fall back to its VRAM-based default and nothing would say so",
    );
  }
});

// The matrix DERIVES contextTokens from profile.defaultContext
// (benchmark.js: `options.contextTokens ?? profile.defaultContext`), so asserting the two agree
// compares a value to its own source and can never fail. Two earlier drafts of this file did
// exactly that and passed while the profile was deliberately broken.
//
// What is worth asserting crosses two independently built things: the `ctx<N>` label baked into
// the configurationId — the string that appears in every published result — and the environment
// the server is actually launched with. Change either construction and this fires.
test("the ctx label in every configurationId is the context the server is launched with", () => {
  const config = loadConfig(ROOT);
  const matrix = buildContentGenMatrix(config, { scenarioCount: 100 });

  for (const entry of matrix.configurations) {
    const labelled = /--ctx(\d+)--/.exec(entry.configurationId);
    assert.ok(labelled, `${entry.configurationId} carries no ctx label to check`);
    const served = serviceEnvironment(getProfile(config, entry.profile.id)).OLLAMA_CONTEXT_LENGTH;
    assert.equal(
      labelled[1], served,
      `${entry.configurationId} is published as ctx${labelled[1]}, but profile `
      + `${entry.profile.id} is served with ${served}. Every result from it would name a window `
      + "the run never had.",
    );
  }
});

// The per-request form is inert on this endpoint and must not come back looking functional.
test("the runner does not set num_ctx per request, where it would be silently dropped", () => {
  const source = require("node:fs").readFileSync(
    resolve(ROOT, "scripts/lib/ak-runner.js"), "utf8",
  );
  assert.match(source, /v1\/chat\/completions/, "this test is anchored to the OpenAI-compatible endpoint");
  assert.doesNotMatch(
    source, /chatBody\.options\s*=/,
    "`options` is an Ollama-native field; the OpenAI-compatible shim discards it without a word",
  );
});
