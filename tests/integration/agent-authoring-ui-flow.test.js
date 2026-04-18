const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { existsSync, mkdtempSync, readFileSync } = require("node:fs");
const { resolve, join } = require("node:path");
const { pathToFileURL } = require("node:url");
const os = require("node:os");

const ROOT = resolve(__dirname, "../..");
const CLI = resolve(ROOT, "packages/adapters-cli/src/cli/ak.mjs");
const UI_WASM_PATH = resolve(ROOT, "packages/ui-web/assets/core-as.wasm");
const BUNDLE_REVIEW_URL = pathToFileURL(resolve(ROOT, "packages/ui-web/src/bundle-review.js")).href;
const PREVIEW_VIEW_URL = pathToFileURL(resolve(ROOT, "packages/ui-web/src/views/preview-view.js")).href;

function runCliOk(args) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`CLI failed (${result.status}): ${output}`);
  }
  return result;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function makeElement(tag = "div") {
  const handlers = new Map();
  const element = {
    tagName: tag.toUpperCase(),
    children: [],
    dataset: {},
    className: "",
    hidden: false,
    value: "",
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    addEventListener(type, handler) {
      handlers.set(type, handler);
    },
    click() {
      return handlers.get("click")?.();
    },
  };
  let text = "";
  Object.defineProperty(element, "textContent", {
    get() {
      return text;
    },
    set(value) {
      text = String(value);
      if (text === "") {
        element.children = [];
      }
    },
  });
  return element;
}

function makeInput(value = "") {
  const element = makeElement("textarea");
  element.value = value;
  return element;
}

function makeButton() {
  const element = makeElement("button");
  element.disabled = false;
  return element;
}

function makeCanvas() {
  const context = {
    imageData: null,
    createImageData(width, height) {
      return {
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4),
      };
    },
    putImageData(imageData) {
      this.imageData = imageData;
    },
    clearRect() {
      this.imageData = null;
    },
  };
  return {
    hidden: true,
    width: 0,
    height: 0,
    getContext() {
      return context;
    },
    _context: context,
  };
}

function createStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
  };
}

function createBundleReviewElements() {
  return {
    bundleInput: makeInput(""),
    manifestInput: makeInput(""),
    loadLastButton: makeButton(),
    clearButton: makeButton(),
    statusEl: makeElement(),
    schemaList: makeElement("ul"),
    manifestOutput: makeElement("pre"),
    specTextarea: makeInput(""),
    specErrors: makeElement("ul"),
    applySpecButton: makeButton(),
    sendSpecButton: makeButton(),
    downloadSpecButton: makeButton(),
    intentOutput: makeElement("pre"),
    planOutput: makeElement("pre"),
    configuratorOutput: makeElement("pre"),
    artifactsContainer: makeElement("div"),
  };
}

function createPreviewRoot() {
  const elements = {
    "#preview-build-and-load": makeButton(),
    "#preview-render-canvas": makeCanvas(),
    "#preview-frame-buffer": makeElement("pre"),
    "#preview-status": makeElement(),
    "#preview-summary": makeElement("pre"),
    "#preview-actor-list": makeElement("pre"),
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

async function loadUiModules() {
  const [{ wireBundleReview }, { wirePreviewView, validatePreviewLaunchBundle }] = await Promise.all([
    import(BUNDLE_REVIEW_URL),
    import(PREVIEW_VIEW_URL),
  ]);
  return { wireBundleReview, wirePreviewView, validatePreviewLaunchBundle };
}

function withUiGlobals(run) {
  const originalDocument = globalThis.document;
  const originalLocalStorage = globalThis.localStorage;
  const originalSessionStorage = globalThis.sessionStorage;
  globalThis.document = {
    createElement(tag) {
      return makeElement(tag);
    },
  };
  globalThis.localStorage = createStorage();
  globalThis.sessionStorage = createStorage();
  return Promise.resolve()
    .then(run)
    .finally(() => {
      globalThis.document = originalDocument;
      globalThis.localStorage = originalLocalStorage;
      globalThis.sessionStorage = originalSessionStorage;
    });
}

function createInjectedPreviewOptions() {
  return {
    levelBuilderAdapter: {
      async buildFromTiles() {
        return {
          ok: true,
          image: {
            width: 5,
            height: 4,
            pixelFormat: "rgba8",
            pixels: new Uint8ClampedArray(5 * 4 * 4).fill(120),
          },
        };
      },
    },
    loadCoreFn: async () => ({
      init() {},
    }),
    applySimConfig: () => ({ ok: true, spawn: { x: 1, y: 1 } }),
    applyInitialState: () => ({ ok: true, actorId: "actor_alpha" }),
    renderFrame: () => ({
      baseTiles: ["#####", "#...#", "#...#", "#####"],
      buffer: ["#####", "#@..#", "#..W#", "#####"],
    }),
    renderBase: () => ["#####", "#...#", "#...#", "#####"],
    readObservationFn: () => ({
      actors: [
        {
          id: "ember_delver",
          position: { x: 1, y: 1 },
          vitals: {
            health: { current: 8, max: 10 },
            mana: { current: 2, max: 4 },
            stamina: { current: 3, max: 5 },
            durability: { current: 6, max: 6 },
          },
        },
        {
          id: "ember_warden",
          position: { x: 3, y: 2 },
          vitals: {
            health: { current: 12, max: 12 },
            mana: { current: 4, max: 4 },
            stamina: { current: 4, max: 4 },
            durability: { current: 8, max: 8 },
          },
        },
      ],
    }),
  };
}

test("preview load reflects the real ui-web core-as.wasm prerequisite", async () => withUiGlobals(async () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-agent-flow-real-preview-"));
  runCliOk([
    "create",
    "--text",
    "Create a small fire room for preview.",
    "--room",
    "size=small;count=1;affinities=fire:emit:2",
    "--run-id",
    "run_agent_flow_real_preview",
    "--created-at",
    "2026-04-08T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const bundle = readJson(join(outDir, "bundle.json"));
  const { wirePreviewView } = await loadUiModules();
  const { elements, root } = createPreviewRoot();
  const preview = wirePreviewView({
    root,
    levelBuilderAdapter: {
      async buildFromTiles() {
        return {
          ok: true,
          image: {
            width: 5,
            height: 4,
            pixelFormat: "rgba8",
            pixels: new Uint8ClampedArray(5 * 4 * 4).fill(120),
          },
        };
      },
    },
    applySimConfig: () => ({ ok: true, spawn: { x: 1, y: 1 } }),
    renderBase: () => ["#####", "#...#", "#...#", "#####"],
  });

  const hasUiWasmAsset = existsSync(UI_WASM_PATH);
  const loaded = await preview.loadBundle(bundle, { source: "file" });

  assert.equal(loaded, hasUiWasmAsset);
  if (hasUiWasmAsset) {
    assert.equal(elements["#preview-render-canvas"].hidden, false);
    assert.equal(elements["#preview-frame-buffer"].hidden, true);
    assert.equal(elements["#preview-status"].textContent, "Layout preview loaded from file.");
  } else {
    assert.equal(elements["#preview-render-canvas"].hidden, true);
    assert.equal(elements["#preview-frame-buffer"].hidden, false);
    assert.match(elements["#preview-status"].textContent, /^Preview failed:/);
    assert.match(elements["#preview-status"].textContent, /core-as\.wasm|ENOENT|no such file/i);
  }
}));

test("mixed-object create bundle survives the CLI -> Diagnostics -> injected Preview -> run-gating flow", async () => withUiGlobals(async () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-agent-flow-mixed-"));
  runCliOk([
    "create",
    "--text",
    "Create a fire room with a trap, one delver, and one warden.",
    "--room",
    "size=large;count=1;affinities=fire:emit:3",
    "--floor-tile",
    "count=18",
    "--trap",
    "x=2;y=2;affinity=fire;expression=push;stacks=2",
    "--delver",
    "id=ember_delver;count=1;affinity=fire;motivation=attacking;setup-mode=user",
    "--warden",
    "id=ember_warden;count=1;affinity=fire;motivation=defending",
    "--run-id",
    "run_agent_flow_mixed",
    "--created-at",
    "2026-04-08T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const bundle = readJson(join(outDir, "bundle.json"));
  const manifest = readJson(join(outDir, "manifest.json"));
  const { wireBundleReview, wirePreviewView, validatePreviewLaunchBundle } = await loadUiModules();
  const bundleElements = createBundleReviewElements();
  const { elements, root } = createPreviewRoot();
  let preview = null;

  preview = wirePreviewView({
    root,
    ...createInjectedPreviewOptions(),
    onBuildAndLoadGame: async () => validatePreviewLaunchBundle(preview.getLastBundle()),
  });

  const bundleReview = wireBundleReview({ elements: bundleElements });

  assert.equal(bundleReview.loadManifestPayload(manifest, { source: "file" }), true);
  assert.equal(bundleReview.loadBundlePayload(bundle, { source: "file" }), true);
  const normalizedSpec = JSON.parse(bundleElements.specTextarea.value);
  assert.deepEqual(normalizedSpec.authoring.objectKinds, [
    "room",
    "floor_tile",
    "trap",
    "delver",
    "warden",
    "shared_config",
  ]);
  assert.match(bundleElements.manifestOutput.textContent, /resource-bundle\.json/);

  const loaded = await preview.loadBundle(bundleReview.getCurrentBundle(), { source: "file" });
  assert.equal(loaded, true);
  assert.equal(elements["#preview-render-canvas"].hidden, false);
  assert.equal(elements["#preview-frame-buffer"].hidden, true);
  assert.match(elements["#preview-summary"].textContent, /Map /);
  assert.match(elements["#preview-summary"].textContent, /Actors 2/);
  assert.match(elements["#preview-actor-list"].textContent, /ember_delver/);
  assert.match(elements["#preview-actor-list"].textContent, /ember_warden/);
  assert.equal(elements["#preview-status"].textContent, "Preview loaded from file.");

  const launchValidation = validatePreviewLaunchBundle(bundleReview.getCurrentBundle());
  assert.equal(launchValidation.ok, true);
  assert.equal(launchValidation.counts.room, 1);
  assert.equal(launchValidation.counts.delver, 1);
  assert.equal(launchValidation.counts.warden, 1);

  const runResult = await preview.buildAndLoadGame();
  assert.deepEqual(runResult, { ok: true });
  assert.equal(elements["#preview-status"].textContent, "Run loaded from Preview.");
}));

test("room-only create bundle still previews the generated room image and remains run-blocked with injected Preview helpers", async () => withUiGlobals(async () => {
  const outDir = mkdtempSync(join(os.tmpdir(), "agent-kernel-agent-flow-room-"));
  runCliOk([
    "create",
    "--text",
    "Create a small fire room for preview.",
    "--room",
    "size=small;count=1;affinities=fire:emit:2",
    "--run-id",
    "run_agent_flow_room",
    "--created-at",
    "2026-04-08T00:00:00.000Z",
    "--out-dir",
    outDir,
  ]);

  const bundle = readJson(join(outDir, "bundle.json"));
  const manifest = readJson(join(outDir, "manifest.json"));
  const { wireBundleReview, wirePreviewView, validatePreviewLaunchBundle } = await loadUiModules();
  const bundleElements = createBundleReviewElements();
  const { elements, root } = createPreviewRoot();
  let preview = null;

  preview = wirePreviewView({
    root,
    ...createInjectedPreviewOptions(),
    onBuildAndLoadGame: async () => validatePreviewLaunchBundle(preview.getLastBundle()),
  });

  const bundleReview = wireBundleReview({ elements: bundleElements });

  assert.equal(bundleReview.loadManifestPayload(manifest, { source: "file" }), true);
  assert.equal(bundleReview.loadBundlePayload(bundle, { source: "file" }), true);
  const normalizedSpec = JSON.parse(bundleElements.specTextarea.value);
  assert.deepEqual(normalizedSpec.authoring.objectKinds, ["room", "shared_config"]);
  assert.equal(normalizedSpec.authoring.request.command.text, "Create a small fire room for preview.");

  const loaded = await preview.loadBundle(bundleReview.getCurrentBundle(), { source: "file" });
  assert.equal(loaded, true);
  assert.equal(elements["#preview-render-canvas"].hidden, false);
  assert.equal(elements["#preview-frame-buffer"].hidden, true);
  assert.equal(elements["#preview-actor-list"].textContent, "Layout-only preview (no actors in initial state).");
  assert.equal(elements["#preview-status"].textContent, "Layout preview loaded from file.");

  const launchValidation = validatePreviewLaunchBundle(bundleReview.getCurrentBundle());
  assert.equal(launchValidation.ok, false);
  assert.deepEqual(launchValidation.missing, ["delver", "warden"]);

  const runResult = await preview.buildAndLoadGame();
  assert.equal(runResult.ok, false);
  assert.equal(runResult.reason, "missing_required_types");
  assert.match(elements["#preview-status"].textContent, /Missing: delver, warden/i);
}));
