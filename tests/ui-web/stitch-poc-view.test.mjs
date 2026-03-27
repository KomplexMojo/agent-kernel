import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_STITCH_POC_FIXTURE_PATH,
  summarizeFixtureBundle,
  wireStitchPocView,
} from "../../packages/ui-web/src/views/stitch-poc-view.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");
const bundlePath = path.resolve(root, "tests", "fixtures", "ui", "build-spec-bundle", "bundle.json");
const htmlPath = path.resolve(root, "packages", "ui-web", "stitch-test.html");
const bundleFixture = JSON.parse(fs.readFileSync(bundlePath, "utf8"));

function makeElement() {
  const handlers = new Map();
  return {
    textContent: "",
    dataset: {},
    addEventListener(type, handler) {
      handlers.set(type, handler);
    },
    click() {
      return handlers.get("click")?.();
    },
  };
}

function createRoot() {
  const elements = {
    "#stitch-poc-status": makeElement(),
    "#stitch-poc-goal": makeElement(),
    "#stitch-poc-run-id": makeElement(),
    "#stitch-poc-map-size": makeElement(),
    "#stitch-poc-actor-count": makeElement(),
    "#stitch-poc-artifact-count": makeElement(),
    "#stitch-poc-tags": makeElement(),
    "#stitch-poc-menu-new": makeElement(),
    "#stitch-poc-menu-continue": makeElement(),
    "#stitch-poc-menu-settings": makeElement(),
    "#stitch-poc-menu-exit": makeElement(),
  };

  return {
    elements,
    root: {
      querySelector(selector) {
        return elements[selector] || null;
      },
    },
  };
}

test("stitch POC bundle summary derives deterministic fixture fields", () => {
  const summary = summarizeFixtureBundle(bundleFixture);

  assert.equal(summary.goal, "demo scenario");
  assert.equal(summary.runId, "run_fixture");
  assert.equal(summary.mapSizeLabel, "2x2");
  assert.equal(summary.actorCount, 1);
  assert.equal(summary.artifactCount, 5);
  assert.equal(summary.tagLabel, "basic");
});

test("stitch POC view renders fixture-backed menu state", async () => {
  const { root: viewRoot, elements } = createRoot();
  let started = 0;

  const view = wireStitchPocView({
    root: viewRoot,
    autoLoad: false,
    onNewJourney: async () => {
      started += 1;
    },
  });

  const result = view.renderFromBundle(bundleFixture, { source: "unit-test" });

  assert.equal(result.ok, true);
  assert.equal(elements["#stitch-poc-goal"].textContent, "demo scenario");
  assert.equal(elements["#stitch-poc-run-id"].textContent, "run_fixture");
  assert.equal(elements["#stitch-poc-map-size"].textContent, "2x2");
  assert.equal(elements["#stitch-poc-actor-count"].textContent, "1");
  assert.equal(elements["#stitch-poc-artifact-count"].textContent, "5");
  assert.equal(elements["#stitch-poc-tags"].textContent, "basic");
  assert.equal(elements["#stitch-poc-status"].textContent, "Main Menu fixture loaded from unit-test.");
  assert.equal(elements["#stitch-poc-status"].dataset.level, "info");

  await elements["#stitch-poc-menu-new"].click();
  assert.equal(started, 1);
  assert.equal(elements["#stitch-poc-status"].textContent, "Main Menu action selected: New Journey.");
});

test("stitch POC view loads fixture via fetch and surfaces errors", async () => {
  const successful = createRoot();
  const view = wireStitchPocView({
    root: successful.root,
    autoLoad: false,
    fetchFn: async (pathArg) => ({
      ok: true,
      json: async () => {
        assert.equal(pathArg, DEFAULT_STITCH_POC_FIXTURE_PATH);
        return bundleFixture;
      },
    }),
  });

  const loaded = await view.loadFixture({ source: "fetch" });
  assert.equal(loaded.ok, true);
  assert.equal(successful.elements["#stitch-poc-status"].textContent, "Main Menu fixture loaded from fetch.");

  const failing = createRoot();
  const failingView = wireStitchPocView({
    root: failing.root,
    autoLoad: false,
    fetchFn: async () => ({ ok: false, status: 404 }),
  });

  const failed = await failingView.loadFixture();
  assert.equal(failed.ok, false);
  assert.match(failing.elements["#stitch-poc-status"].textContent, /Fixture request failed \(404\)/);
  assert.equal(failing.elements["#stitch-poc-status"].dataset.level, "error");
});

test("stitch POC view runs a real command-host normalization action", async () => {
  const { root: viewRoot, elements } = createRoot();
  let normalizeCalls = 0;
  const commandHost = {
    async normalizeBuildSpec({ spec }) {
      normalizeCalls += 1;
      assert.equal(spec?.meta?.runId, "run_fixture");
      return { spec, changed: false };
    },
  };

  const view = wireStitchPocView({
    root: viewRoot,
    autoLoad: false,
    commandHost,
  });
  view.renderFromBundle(bundleFixture, { source: "fixture" });

  await elements["#stitch-poc-menu-continue"].click();

  assert.equal(normalizeCalls, 1);
  assert.match(elements["#stitch-poc-status"].textContent, /Command host normalized BuildSpec/);
  assert.equal(elements["#stitch-poc-status"].dataset.level, "info");
  assert.equal(view.getLastNormalizedSpec()?.meta?.runId, "run_fixture");
});

test("stitch POC view surfaces command-host normalization errors", async () => {
  const withoutFixture = createRoot();
  const withoutFixtureView = wireStitchPocView({
    root: withoutFixture.root,
    autoLoad: false,
    commandHost: {
      async normalizeBuildSpec() {
        return { spec: bundleFixture.spec, changed: false };
      },
    },
  });

  await withoutFixture.elements["#stitch-poc-menu-continue"].click();
  assert.equal(withoutFixtureView.getLastNormalizedSpec(), null);
  assert.match(withoutFixture.elements["#stitch-poc-status"].textContent, /Load fixture bundle before running command-host normalization/);
  assert.equal(withoutFixture.elements["#stitch-poc-status"].dataset.level, "error");

  const failingHost = createRoot();
  const failingView = wireStitchPocView({
    root: failingHost.root,
    autoLoad: false,
    commandHost: {
      async normalizeBuildSpec() {
        throw new Error("host unavailable");
      },
    },
  });
  failingView.renderFromBundle(bundleFixture, { source: "fixture" });

  await failingHost.elements["#stitch-poc-menu-continue"].click();
  assert.equal(failingView.getLastNormalizedSpec(), null);
  assert.match(failingHost.elements["#stitch-poc-status"].textContent, /Command-host normalization failed: host unavailable/);
  assert.equal(failingHost.elements["#stitch-poc-status"].dataset.level, "error");
});

test("stitch test page wires the module entrypoint", () => {
  const html = fs.readFileSync(htmlPath, "utf8");

  assert.match(html, /id="stitch-poc-status"/);
  assert.match(html, /id="stitch-poc-menu-new"/);
  assert.match(html, /id="stitch-poc-goal"/);
  assert.match(html, /createCliWorkerAdapter\(\)/);
  assert.match(html, /wireStitchPocView\(\{ commandHost \}\)/);
  assert.match(html, /adapters-web\/src\/adapters\/cli-worker\/index\.js/);
  assert.match(html, /src\/views\/stitch-poc-view\.js/);
});
