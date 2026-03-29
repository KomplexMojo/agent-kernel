import { test } from "node:test";
import assert from "node:assert/strict";

import { createActorInspector } from "../../packages/ui-web/src/actor-inspector.js";

// Fake DOM implementation for testing
class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.className = "";
    this.textContent = "";
    this.innerHTML = "";
    this.title = "";
    this.type = "";
    this.dataset = {};
    this.children = [];
    this.hidden = false;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  append(...children) {
    children.forEach((child) => {
      if (child) this.children.push(child);
    });
  }

  removeChild(child) {
    this.children = this.children.filter((c) => c !== child);
  }

  replaceChildren(...newChildren) {
    this.children = newChildren.filter(Boolean);
  }

  addEventListener() {
    // Stub
  }

  get classList() {
    return {
      add: (...names) => {
        names.forEach((name) => {
          if (!this.className.includes(name)) {
            this.className = this.className ? `${this.className} ${name}` : name;
          }
        });
      },
    };
  }
}

class FakeDocument {
  createElement(tagName) {
    return new FakeElement(tagName);
  }
}

function withFakeDOM(run) {
  const originalDocument = global.document;
  const fakeDocument = new FakeDocument();
  global.document = fakeDocument;
  try {
    return run(fakeDocument);
  } finally {
    global.document = originalDocument;
  }
}

function createMockBundle() {
  return {
    mappings: {
      icons: {
        types: {
          attacker: "asset-attacker",
          defender: "asset-defender",
        },
        affinities: {
          fire: "asset-fire",
          water: "asset-water",
        },
        expressions: {
          push: "asset-push",
          emit: "asset-emit",
        },
        motivations: {
          attacking: "asset-attacking",
          defending: "asset-defending",
        },
      },
    },
    assets: [
      { id: "asset-attacker", dataUri: "data:image/png;base64,ATTACKER" },
      { id: "asset-defender", dataUri: "data:image/png;base64,DEFENDER" },
      { id: "asset-fire", dataUri: "data:image/png;base64,FIRE" },
      { id: "asset-water", dataUri: "data:image/png;base64,WATER" },
      { id: "asset-push", dataUri: "data:image/png;base64,PUSH" },
      { id: "asset-emit", dataUri: "data:image/png;base64,EMIT" },
      { id: "asset-attacking", dataUri: "data:image/png;base64,ATTACKING" },
      { id: "asset-defending", dataUri: "data:image/png;base64,DEFENDING" },
    ],
  };
}

test("actor inspector renders bundle images in group row chips", () =>
  withFakeDOM(() => {
    const roomListEl = new FakeElement("div");
    const attackerListEl = new FakeElement("div");
    const defenderListEl = new FakeElement("div");
    const detailEl = new FakeElement("div");

    const inspector = createActorInspector({
      containerEl: new FakeElement("div"),
      roomListEl,
      attackerListEl,
      defenderListEl,
      detailEl,
    });

    const bundle = createMockBundle();
    inspector.setResourceBundle(bundle);

    inspector.setScenario({
      spec: {
        configurator: {
          inputs: {
            cardSet: [
              {
                id: "ATTACKER-1",
                type: "attacker",
                count: 1,
                affinity: "fire",
                affinities: [{ kind: "fire", expression: "push", stacks: 1 }],
                motivations: ["attacking"],
              },
            ],
          },
        },
      },
      initialState: { actors: [] },
      simConfig: { layout: { data: { rooms: [] } } },
    });

    // Check that attacker list has a row
    assert.ok(attackerListEl.children.length > 0, "Should have attacker rows");
    const row = attackerListEl.children[0];
    assert.ok(row, "Should have first attacker row");

    // Find the preview span with icon chips
    const preview = row.children.find((child) => child.className?.includes("design-card-group-preview"));
    assert.ok(preview, "Should have preview element");

    // Check that chips contain bundle images (via innerHTML)
    const chips = preview.children.filter((child) => child.className?.includes("design-card-icon-chip"));
    assert.ok(chips.length > 0, "Should have icon chips");

    // Type chip should have bundle image
    const typeChip = chips.find((chip) => chip.className?.includes("is-type"));
    assert.ok(typeChip, "Should have type chip");
    assert.match(typeChip.innerHTML, /<img/, "Type chip should contain img tag from bundle");
    assert.match(typeChip.innerHTML, /ATTACKER/, "Type chip should use attacker asset");

    // Affinity chip should have bundle image
    const affinityChip = chips.find((chip) => chip.className?.includes("is-affinity"));
    assert.ok(affinityChip, "Should have affinity chip");
    assert.match(affinityChip.innerHTML, /<img/, "Affinity chip should contain img tag from bundle");
    assert.match(affinityChip.innerHTML, /FIRE/, "Affinity chip should use fire asset");

    // Motivation chip should have bundle image
    const motivationChip = chips.find((chip) => chip.className?.includes("is-motivation"));
    assert.ok(motivationChip, "Should have motivation chip");
    assert.match(motivationChip.innerHTML, /<img/, "Motivation chip should contain img tag from bundle");
    assert.match(motivationChip.innerHTML, /ATTACKING/, "Motivation chip should use attacking asset");
  }));

test("actor inspector falls back to glyphs when bundle is missing", () =>
  withFakeDOM(() => {
    const roomListEl = new FakeElement("div");
    const attackerListEl = new FakeElement("div");
    const defenderListEl = new FakeElement("div");
    const detailEl = new FakeElement("div");

    const inspector = createActorInspector({
      containerEl: new FakeElement("div"),
      roomListEl,
      attackerListEl,
      defenderListEl,
      detailEl,
    });

    // No bundle set
    inspector.setScenario({
      spec: {
        configurator: {
          inputs: {
            cardSet: [
              {
                id: "ATTACKER-1",
                type: "attacker",
                count: 1,
                affinity: "fire",
                affinities: [{ kind: "fire", expression: "push", stacks: 1 }],
                motivations: ["attacking"],
              },
            ],
          },
        },
      },
      initialState: { actors: [] },
      simConfig: { layout: { data: { rooms: [] } } },
    });

    const row = attackerListEl.children[0];
    const preview = row?.children.find((child) => child.className?.includes("design-card-group-preview"));
    const chips = preview?.children.filter((child) => child.className?.includes("design-card-icon-chip")) || [];

    // Type chip should have glyph fallback
    const typeChip = chips.find((chip) => chip.className?.includes("is-type"));
    assert.ok(typeChip, "Should have type chip");
    assert.equal(typeChip.innerHTML, "⚔️", "Type chip should show attacker glyph");

    // Affinity chip should have glyph fallback
    const affinityChip = chips.find((chip) => chip.className?.includes("is-affinity"));
    assert.ok(affinityChip, "Should have affinity chip");
    assert.equal(affinityChip.innerHTML, "🔥", "Affinity chip should show fire glyph");

    // Motivation chip should have glyph fallback
    const motivationChip = chips.find((chip) => chip.className?.includes("is-motivation"));
    assert.ok(motivationChip, "Should have motivation chip");
    assert.equal(motivationChip.innerHTML, "⚔️", "Motivation chip should show attacking glyph");
  }));

test("actor inspector detail panel renders bundle images", () =>
  withFakeDOM(() => {
    const detailEl = new FakeElement("div");

    const inspector = createActorInspector({
      containerEl: new FakeElement("div"),
      roomListEl: new FakeElement("div"),
      attackerListEl: new FakeElement("div"),
      defenderListEl: new FakeElement("div"),
      detailEl,
    });

    const bundle = createMockBundle();
    inspector.setResourceBundle(bundle);

    inspector.setScenario({
      spec: {
        configurator: {
          inputs: {
            cardSet: [
              {
                id: "DEFENDER-1",
                type: "defender",
                count: 1,
                affinity: "water",
                affinities: [
                  { kind: "water", expression: "emit", stacks: 2 },
                  { kind: "fire", expression: "push", stacks: 1 },
                ],
                motivations: ["defending"],
              },
            ],
          },
        },
      },
      initialState: { actors: [] },
      simConfig: { layout: { data: { rooms: [] } } },
    });

    // Detail should render a card
    const card = detailEl.children.find((child) => child.className?.includes("design-card"));
    assert.ok(card, "Should have design card in detail");

    // Check affinity list for expression icons
    const affinityList = card.children.find((child) =>
      child.className?.includes("simulation-inspector-affinity-list"),
    );
    assert.ok(affinityList, "Should have affinity list");

    const affinityRows = affinityList.children.filter((child) =>
      child.className?.includes("simulation-inspector-affinity-row"),
    );
    assert.ok(affinityRows.length >= 2, "Should have affinity rows for water:emit and fire:push");

    // Check first affinity row (water:emit)
    const waterRow = affinityRows[0];
    const waterChips = waterRow.children.filter((child) => child.className?.includes("design-card-icon-chip"));
    assert.equal(waterChips.length, 2, "Should have affinity + expression chips");

    const waterAffinityChip = waterChips.find((chip) => chip.className?.includes("is-affinity"));
    assert.ok(waterAffinityChip, "Should have water affinity chip");
    assert.match(waterAffinityChip.innerHTML, /<img/, "Water affinity should use bundle image");
    assert.match(waterAffinityChip.innerHTML, /WATER/, "Should use water asset");

    const emitExpressionChip = waterChips.find((chip) => chip.className?.includes("is-expression"));
    assert.ok(emitExpressionChip, "Should have emit expression chip");
    assert.match(emitExpressionChip.innerHTML, /<img/, "Emit expression should use bundle image");
    assert.match(emitExpressionChip.innerHTML, /EMIT/, "Should use emit asset");

    // Check second affinity row (fire:push)
    const fireRow = affinityRows[1];
    const fireChips = fireRow.children.filter((child) => child.className?.includes("design-card-icon-chip"));

    const pushExpressionChip = fireChips.find((chip) => chip.className?.includes("is-expression"));
    assert.ok(pushExpressionChip, "Should have push expression chip");
    assert.match(pushExpressionChip.innerHTML, /<img/, "Push expression should use bundle image");
    assert.match(pushExpressionChip.innerHTML, /PUSH/, "Should use push asset");
  }));

test("actor inspector detail panel falls back to legacy glyphs without bundle", () =>
  withFakeDOM(() => {
    const detailEl = new FakeElement("div");

    const inspector = createActorInspector({
      containerEl: new FakeElement("div"),
      roomListEl: new FakeElement("div"),
      attackerListEl: new FakeElement("div"),
      defenderListEl: new FakeElement("div"),
      detailEl,
    });

    // No bundle
    inspector.setScenario({
      spec: {
        configurator: {
          inputs: {
            cardSet: [
              {
                id: "ATTACKER-1",
                type: "attacker",
                count: 1,
                affinity: "fire",
                affinities: [
                  { kind: "fire", expression: "push", stacks: 1 },
                  { kind: "water", expression: "pull", stacks: 1 },
                ],
                motivations: ["exploring", "attacking"],
              },
            ],
          },
        },
      },
      initialState: { actors: [] },
      simConfig: { layout: { data: { rooms: [] } } },
    });

    const card = detailEl.children.find((child) => child.className?.includes("design-card"));
    const affinityList = card?.children.find((child) =>
      child.className?.includes("simulation-inspector-affinity-list"),
    );
    const affinityRows = affinityList?.children.filter((child) =>
      child.className?.includes("simulation-inspector-affinity-row"),
    ) || [];

    // Check fire:push row
    const firePushRow = affinityRows[0];
    const firePushChips = firePushRow?.children.filter((child) =>
      child.className?.includes("design-card-icon-chip"),
    ) || [];

    const fireAffinity = firePushChips.find((chip) => chip.className?.includes("is-affinity"));
    assert.equal(fireAffinity?.innerHTML, "🔥", "Fire affinity should use legacy glyph");

    const pushExpression = firePushChips.find((chip) => chip.className?.includes("is-expression"));
    assert.equal(pushExpression?.innerHTML, "⬆️", "Push expression should use legacy glyph");

    // Check water:pull row
    const waterPullRow = affinityRows[1];
    const waterPullChips = waterPullRow?.children.filter((child) =>
      child.className?.includes("design-card-icon-chip"),
    ) || [];

    const waterAffinity = waterPullChips.find((chip) => chip.className?.includes("is-affinity"));
    assert.equal(waterAffinity?.innerHTML, "💧", "Water affinity should use legacy glyph");

    const pullExpression = waterPullChips.find((chip) => chip.className?.includes("is-expression"));
    assert.equal(pullExpression?.innerHTML, "⬇️", "Pull expression should use legacy glyph");

    // Check motivation chips in traits section
    const traits = card?.children.find((child) => child.className?.includes("design-card-traits"));
    const motivationChips = traits?.children.filter((child) =>
      child.className?.includes("is-motivation"),
    ) || [];

    assert.ok(motivationChips.length >= 2, "Should have motivation chips");
    assert.equal(motivationChips[0]?.innerHTML, "🧭", "Exploring motivation should use legacy glyph");
    assert.equal(motivationChips[1]?.innerHTML, "⚔️", "Attacking motivation should use legacy glyph");
  }));
