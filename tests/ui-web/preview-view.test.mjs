import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePreviewLaunchBundle, wirePreviewView } from "../../packages/ui-web/src/views/preview-view.js";

function makeElement() {
  const handlers = new Map();
  return {
    textContent: "",
    dataset: {},
    hidden: false,
    addEventListener(type, handler) {
      handlers.set(type, handler);
    },
    click() {
      return handlers.get("click")?.();
    },
  };
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

function createRoot() {
  const elements = {
    "#preview-build-and-load": makeElement(),
    "#preview-render-canvas": makeCanvas(),
    "#preview-frame-buffer": makeElement(),
    "#preview-status": makeElement(),
    "#preview-summary": makeElement(),
    "#preview-actor-list": makeElement(),
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

function createBundle({
  actors = [{ id: "attacker_alpha", position: { x: 1, y: 1 }, vitals: { health: { current: 8, max: 10 }, mana: { current: 2, max: 4 }, stamina: { current: 3, max: 5 }, durability: { current: 6, max: 6 } } }],
  cardSet = [
    { id: "room_alpha", type: "room", count: 1 },
    { id: "attacker_alpha", type: "delver", count: 1 },
    { id: "defender_alpha", type: "warden", count: 1 },
  ],
} = {}) {
  return {
    spec: {
      plan: {
        hints: {
          cardSet,
        },
      },
    },
    artifacts: [
      {
        schema: "agent-kernel/SimConfigArtifact",
        seed: 7,
        layout: {
          data: {
            width: 5,
            height: 4,
            rooms: [{ x: 0, y: 0, width: 5, height: 4 }],
          },
        },
      },
      {
        schema: "agent-kernel/InitialStateArtifact",
        actors,
      },
    ],
  };
}

test("preview launch validation requires at least one room, delver, and warden in the authored card set", () => {
  const valid = validatePreviewLaunchBundle(createBundle());
  assert.equal(valid.ok, true);
  assert.equal(valid.counts.room, 1);
  assert.equal(valid.counts.delver, 1);
  assert.equal(valid.counts.warden, 1);

  const invalid = validatePreviewLaunchBundle(createBundle({
    cardSet: [
      { id: "room_alpha", type: "room", count: 1 },
      { id: "attacker_alpha", type: "delver", count: 1 },
    ],
  }));
  assert.equal(invalid.ok, false);
  assert.equal(invalid.reason, "missing_required_types");
  assert.deepEqual(invalid.missing, ["warden"]);
  assert.match(invalid.message, /configure at least 1 room, 1 delver, and 1 warden/i);
});

test("preview launch validation merges authored card templates across plan and configurator sources", () => {
  const bundle = createBundle({
    cardSet: [
      { id: "attacker_alpha", type: "delver", count: 1 },
    ],
  });
  bundle.spec.configurator = {
    inputs: {
      cardSet: [
        { id: "room_alpha", type: "room", count: 1 },
      ],
    },
  };
  bundle.spec.plan.hints.cardSet = [
    { id: "attacker_alpha", type: "delver", count: 1 },
    { id: "defender_alpha", type: "warden", count: 1 },
  ];

  const valid = validatePreviewLaunchBundle(bundle);
  assert.equal(valid.ok, true);
  assert.equal(valid.counts.room, 1);
  assert.equal(valid.counts.delver, 1);
  assert.equal(valid.counts.warden, 1);
});

test("preview view renders bundle-backed frame and actor summaries", async () => {
  const { root, elements } = createRoot();
  const view = wirePreviewView({
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
    loadCoreFn: async () => ({
      init(seed) {
        this.seed = seed;
      },
    }),
    applySimConfig: () => ({ ok: true, spawn: { x: 1, y: 1 } }),
    applyInitialState: () => ({ ok: true, actorId: "attacker_alpha" }),
    renderFrame: () => ({ buffer: ["#####", "#@..#", "#...#", "#####"] }),
    renderBase: () => ["#####", "#...#", "#...#", "#####"],
    readObservationFn: () => ({
      actors: [
        {
          id: "attacker_alpha",
          position: { x: 1, y: 1 },
          vitals: {
            health: { current: 8, max: 10 },
            mana: { current: 2, max: 4 },
            stamina: { current: 3, max: 5 },
            durability: { current: 6, max: 6 },
          },
        },
      ],
    }),
  });

  const loaded = await view.loadBundle(createBundle(), { source: "design-build" });
  assert.equal(loaded, true);
  assert.equal(elements["#preview-render-canvas"].hidden, false);
  assert.equal(elements["#preview-frame-buffer"].hidden, true);
  assert.equal(elements["#preview-render-canvas"].width, 5);
  assert.equal(elements["#preview-render-canvas"].height, 4);
  assert.match(elements["#preview-frame-buffer"].textContent, /#@\.\.#/);
  assert.match(elements["#preview-summary"].textContent, /Map 5x4/);
  assert.match(elements["#preview-summary"].textContent, /Rooms 1/);
  assert.match(elements["#preview-actor-list"].textContent, /attacker_alpha/);
  assert.equal(elements["#preview-status"].textContent, "Preview loaded from design-build.");
  assert.equal(elements["#preview-status"].dataset.level, "info");
});

test("preview view runs build-and-load from the preview toolbar", async () => {
  const { root, elements } = createRoot();
  let buildCount = 0;

  const view = wirePreviewView({
    root,
    onBuildAndLoadGame: async () => {
      buildCount += 1;
      return { ok: true, message: "Run loaded from Preview." };
    },
  });

  await view.buildAndLoadGame();

  assert.equal(buildCount, 1);
  assert.equal(elements["#preview-status"].textContent, "Run loaded from Preview.");

  await elements["#preview-build-and-load"].click();

  assert.equal(buildCount, 2);
});

test("preview view surfaces launch guard errors returned by the preview build handler", async () => {
  const { root, elements } = createRoot();

  const view = wirePreviewView({
    root,
    onBuildAndLoadGame: async () => validatePreviewLaunchBundle(createBundle({
      cardSet: [
        { id: "room_alpha", type: "room", count: 1 },
        { id: "attacker_alpha", type: "delver", count: 1 },
      ],
    })),
  });

  const result = await view.buildAndLoadGame();

  assert.equal(result.ok, false);
  assert.equal(result.reason, "missing_required_types");
  assert.match(elements["#preview-status"].textContent, /Missing: warden/i);
  assert.equal(elements["#preview-status"].dataset.level, "error");
});

test("preview view falls back to layout-only rendering when the bundle has no actors", async () => {
  const { root, elements } = createRoot();
  const view = wirePreviewView({
    root,
    levelBuilderAdapter: {
      async buildFromTiles() {
        return { ok: true, image: null };
      },
    },
    loadCoreFn: async () => ({ init() {} }),
    applySimConfig: () => ({ ok: true, spawn: { x: 1, y: 1 } }),
    renderBase: () => ["#####", "#...#", "#...#", "#####"],
  });

  const loaded = await view.loadBundle(createBundle({ actors: [] }), { source: "snapshot" });
  assert.equal(loaded, true);
  assert.equal(elements["#preview-render-canvas"].hidden, true);
  assert.equal(elements["#preview-frame-buffer"].hidden, false);
  assert.match(elements["#preview-frame-buffer"].textContent, /#\.\.\.#/);
  assert.equal(elements["#preview-actor-list"].textContent, "Layout-only preview (no actors in initial state).");
  assert.equal(elements["#preview-status"].textContent, "Layout preview loaded from snapshot.");
});

test("preview view clears when bundle data is removed", async () => {
  const { root, elements } = createRoot();
  const view = wirePreviewView({ root });

  const cleared = await view.loadBundle(null);
  assert.equal(cleared, false);
  assert.equal(elements["#preview-render-canvas"].hidden, true);
  assert.equal(elements["#preview-frame-buffer"].hidden, false);
  assert.equal(elements["#preview-frame-buffer"].textContent, "No preview loaded.");
  assert.equal(elements["#preview-summary"].textContent, "No preview bundle loaded.");
  assert.equal(
    elements["#preview-status"].textContent,
    "Inspect the current design bundle here. When ready, use Build And Load Game to open Run.",
  );
  assert.equal(elements["#preview-status"].dataset.level, "info");
});
