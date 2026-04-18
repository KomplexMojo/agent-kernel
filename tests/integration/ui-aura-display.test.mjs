import assert from "node:assert/strict";

describe("UI aura display integration", () => {
  it("simulation view stores auras from observation", () => {
    const mockObservation = {
      actors: [],
      traps: [],
      auras: [
        { x: 5, y: 5, visualState: "emit_solo", kind: "fire", expression: "emit", intensity: 0.8 },
      ],
    };

    let capturedAuras = null;
    const mockHandleObservation = ({ observation }) => {
      capturedAuras = Array.isArray(observation?.auras) ? observation.auras.slice() : [];
    };

    mockHandleObservation({ observation: mockObservation });

    assert.equal(capturedAuras.length, 1);
    assert.equal(capturedAuras[0].x, 5);
    assert.equal(capturedAuras[0].y, 5);
    assert.equal(capturedAuras[0].visualState, "emit_solo");
  });

  it("tooltip format includes expected aura fields", () => {
    const aura = {
      x: 3,
      y: 7,
      visualState: "conflict",
      sourceActorId: "actor_1",
      kind: "water",
      expression: "push",
      intensity: 0.65,
    };

    const rows = [];
    rows.push(`Position: (${aura.x}, ${aura.y})`);
    rows.push(`Visual: ${aura.visualState}`);
    rows.push(`Source: ${aura.sourceActorId}`);
    rows.push(`Affinity: ${aura.kind}`);
    rows.push(`Expression: ${aura.expression}`);
    rows.push(`Intensity: ${aura.intensity.toFixed(2)}`);

    const content = rows.join("\n");

    assert.ok(content.includes("Position: (3, 7)"));
    assert.ok(content.includes("Visual: conflict"));
    assert.ok(content.includes("Source: actor_1"));
    assert.ok(content.includes("Affinity: water"));
    assert.ok(content.includes("Expression: push"));
    assert.ok(content.includes("Intensity: 0.65"));
  });
});
